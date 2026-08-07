const admin = require("firebase-admin");
const scoring = require("./ladder_scoring.js");
const utilities = require("./utilities.js");

module.exports.ladderStandings = ladderStandings;
module.exports.buildStandings = buildStandings;
module.exports.replayMatches = replayMatches;
module.exports.resolveSeason = resolveSeason;

// Realtime Database paths.
const LADDER_MATCHES = "ladder_matches"; // ladder_matches/{groupId}/{seasonId}/{matchId}
const LADDER_SEASONS = "ladder_seasons"; // ladder_seasons/{groupId}/{seasonId} -- season archive
const GROUPS = "groups-v2";
const USERS = "approvedNumbers";

/**
 * ============================ HOW STANDINGS WORK ============================
 * Standings are a PURE FUNCTION of the match log. Nothing is stored
 * incrementally: every call to buildStandings replays every confirmed match for
 * the season, in chronological order, from zero.
 *
 * This is deliberate. A match's rank-distance points depend on where the two
 * players sat at the moment they played, so editing or deleting one match
 * changes the correct score of every match that came after it. Only a full
 * replay can honour that. Reporting, editing and deleting a match therefore only
 * ever write to the match log -- they never touch a running total, because there
 * is no running total to get out of sync.
 * ==========================================================================
 */

/**
 * Tie handling.
 *
 * "shared": players level on points share a rank (1, 1, 3). Rows are still
 *           emitted in a deterministic order using the tiebreakers below, so
 *           the client's array order never jitters between calls.
 * "strict": tiebreakers fully resolve the order and every player gets a
 *           distinct rank (1, 2, 3).
 */
const TIE_POLICY = "shared";

/**
 * Deterministic ordering. Applied in sequence until one differentiates.
 * Points first (that is the ladder); the rest only exist so identical
 * point totals don't shuffle between requests.
 */
function compareRows(a, b) {
    if (b.points !== a.points) return b.points - a.points;
    const aDiff = (a.gamesWon || 0) - (a.gamesLost || 0);
    const bDiff = (b.gamesWon || 0) - (b.gamesLost || 0);
    if (bDiff !== aDiff) return bDiff - aDiff;
    if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
    if ((a.losses || 0) !== (b.losses || 0)) return (a.losses || 0) - (b.losses || 0);
    // Last resort: stable, arbitrary, but never random.
    return String(a.playerId).localeCompare(String(b.playerId));
}

/**
 * POST /v1/ladderStandings
 * body: { groupId, seasonId }
 *
 * Read-only. Replays the season's match log and returns the ranked rows.
 */
async function ladderStandings(req, res) {
    const body = req.body || {};
    const { groupId, seasonId } = body;

    if (!groupId || !seasonId) {
        res.status(400).send({ error: "A group and a ladder season are required to load standings." });
        return;
    }

    try {
        const groupSnap = await admin.database().ref(GROUPS).child(groupId).get();
        const group = groupSnap.val();
        if (group == null) {
            res.status(404).send({ error: "We couldn't find that group." });
            return;
        }

        const season = await resolveSeason(groupId, seasonId, group);
        if (season == null) {
            res.status(404).send({
                error: "We couldn't find that ladder season for this group.",
            });
            return;
        }

        const rows = await buildStandings(groupId, seasonId);

        res.status(200).send({
            data: {
                result: "success",
                standings: { seasonId, rows },
            },
        });
    } catch (e) {
        console.error("ladderStandings error", e);
        res.status(500).send({ error: "We couldn't load the ladder standings. Please try again." });
    }
}

/**
 * Confirms seasonId belongs to this group, and returns the season object.
 *
 * Accepts a season if either it is the group's current ladderSeason, or it is
 * archived under ladder_seasons/{groupId}/{seasonId}. Seeing an active season
 * archives it as a side effect, so it stays resolvable after it ends. Falls back
 * to the match log so a season with played matches always resolves. Returns null
 * when the season is unknown or belongs to another group.
 */
async function resolveSeason(groupId, seasonId, group) {
    const current = group?.ladderSeason;
    if (current != null && current.id === seasonId) {
        // Archive (or refresh) so this season outlives the group's current field.
        await admin.database().ref(LADDER_SEASONS).child(groupId).child(seasonId).update({
            id: current.id,
            name: current.name ?? null,
            startTimestamp: current.startTimestamp ?? null,
            endTimestamp: current.endTimestamp ?? null,
        });
        return current;
    }

    const archivedSnap = await admin.database().ref(LADDER_SEASONS).child(groupId).child(seasonId).get();
    if (archivedSnap.exists()) {
        return archivedSnap.val();
    }

    // Fall back to the match log: a season with played matches but no archive
    // entry is still a real season.
    const matchesSnap = await admin.database().ref(LADDER_MATCHES).child(groupId).child(seasonId).get();
    if (matchesSnap.exists()) {
        return { id: seasonId };
    }

    return null;
}

/**
 * Builds the sorted, ranked rows for one season by replaying its match log.
 *
 * Returns [] for a season with no matches (never null, never an error).
 */
async function buildStandings(groupId, seasonId) {
    const matches = await loadMatches(groupId, seasonId);
    if (matches.length === 0) return [];

    const { tallies, previousRanks } = replayMatches(matches);
    const finalRanks = rankMap(tallies);

    const entries = Object.entries(tallies).map(([playerId, tally]) => ({
        playerId,
        ...tally,
        rank: finalRanks[playerId],
    }));
    entries.sort(compareRows);

    const names = await resolveNames(entries);

    return entries.map((entry) => ({
        playerId: entry.playerId,
        name: names[entry.playerId],
        rank: entry.rank,
        points: Math.round(entry.points),
        // Places gained (+) or lost (-) as a result of the season's most recent
        // match. previousRanks is the ranking as it stood just before that match,
        // so opening the tab twice shows the same arrows. A player who wasn't
        // ranked before that match (0 or 1 total matches) shows no movement.
        movement: previousRanks[entry.playerId] == null
            ? 0
            : previousRanks[entry.playerId] - entry.rank,
    }));
}

/**
 * Reads the season's matches, chronologically ordered.
 *
 * Order is (timestamp, reportedAt, id) so the replay is deterministic and a late
 * edit that keeps the played-at time doesn't reshuffle history.
 */
async function loadMatches(groupId, seasonId) {
    const snap = await admin.database().ref(LADDER_MATCHES).child(groupId).child(seasonId).get();
    const val = snap.val();
    if (val == null) return [];
    // A contested match is on hold: it stays in the log but its points come off
    // until it's resolved, so the replay leaves it out.
    return Object.values(val)
        .filter((match) => match?.contestation?.isContested !== true)
        .sort(compareMatches);
}

function compareMatches(a, b) {
    const at = a.timestamp ?? a.reportedAt ?? 0;
    const bt = b.timestamp ?? b.reportedAt ?? 0;
    if (at !== bt) return at - bt;
    const ar = a.reportedAt ?? 0;
    const br = b.reportedAt ?? 0;
    if (ar !== br) return ar - br;
    return String(a.id).localeCompare(String(b.id));
}

/**
 * Replays matches into per-player tallies, in order.
 *
 * Each match is scored against the ranking as it stood BEFORE that match, then
 * its points are folded in -- so a later match always sees the effect of every
 * earlier one. Also captures the ranking just before the final match, which is
 * what `movement` is measured against.
 *
 * @return {{ tallies: object, previousRanks: object }}
 */
function replayMatches(matches) {
    const tallies = {}; // playerId -> { points, wins, losses, gamesWon, gamesLost }
    let previousRanks = {};

    matches.forEach((match, index) => {
        const ranksBefore = rankMap(tallies);
        if (index === matches.length - 1) {
            previousRanks = ranksBefore;
        }
        applyMatch(tallies, match, ranksBefore);
    });

    return { tallies, previousRanks };
}

function emptyTally() {
    return { points: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0 };
}

/**
 * Folds one match into the tallies, scoring it against `ranksBefore`.
 *
 * A player with no tally yet is unranked; we place them just below everyone
 * ranked (playerCount + 1), so the first match of a season -- both players
 * unranked -- is pure base points (zero rank gap, zero distance).
 */
function applyMatch(tallies, match, ranksBefore) {
    const { winnerId, loserId } = match;
    if (winnerId == null || loserId == null) return; // skip malformed records

    const unrankedRank = Object.keys(tallies).length + 1;
    const winnerRank = ranksBefore[winnerId] ?? unrankedRank;
    const loserRank = ranksBefore[loserId] ?? unrankedRank;

    // Re-express the stored (reporter-perspective) sets from the winner's side,
    // so the scorer's loserGames really are the loser's games.
    const winnerIsReporter = winnerId === match.reportedBy;
    const sets = (match.sets || []).map((set) => ({
        winnerGames: winnerIsReporter ? set.reporterGames : set.opponentGames,
        loserGames: winnerIsReporter ? set.opponentGames : set.reporterGames,
        isTiebreak: set.isTiebreak === true,
    }));
    const winnerGames = sets.reduce((n, s) => n + s.winnerGames, 0);
    const loserGames = sets.reduce((n, s) => n + s.loserGames, 0);

    const scored = scoring.scoreMatch({
        winnerRank,
        loserRank,
        sets,
        // Stored answers name a player by id, so the scorer needs both ids to
        // tell whose side the balls bonus falls on.
        balls: match.balls ?? null,
        winnerId,
        loserId,
    });

    const w = (tallies[winnerId] ??= emptyTally());
    w.points += scored.winnerPoints;
    w.wins += 1;
    w.gamesWon += winnerGames;
    w.gamesLost += loserGames;

    const l = (tallies[loserId] ??= emptyTally());
    l.points += scored.loserPoints;
    l.losses += 1;
    l.gamesWon += loserGames;
    l.gamesLost += winnerGames;
}

/**
 * Maps each player in `tallies` to a 1-based rank, using the same ordering and
 * tie policy the standings are displayed with.
 */
function rankMap(tallies) {
    const entries = Object.entries(tallies).map(([playerId, tally]) => ({ playerId, ...tally }));
    entries.sort(compareRows);
    assignRanks(entries);
    const map = {};
    entries.forEach((entry) => { map[entry.playerId] = entry.rank; });
    return map;
}

/**
 * Assigns a 1-based `rank` to each entry, in place. Expects entries already
 * sorted by compareRows.
 */
function assignRanks(entries) {
    entries.forEach((entry, index) => {
        if (TIE_POLICY === "shared" && index > 0 && entry.points === entries[index - 1].points) {
            // Level on points: share the rank above (1, 1, 3).
            entry.rank = entries[index - 1].rank;
        } else {
            entry.rank = index + 1;
        }
    });
}

/**
 * Display names, already formatted ("Brad T.") -- the client does no formatting.
 * Falls back to something readable when a user record is gone.
 */
async function resolveNames(entries) {
    const names = {};
    await Promise.all(entries.map(async (entry) => {
        if (entry.name) {
            names[entry.playerId] = entry.name;
            return;
        }
        const snap = await admin.database().ref(USERS).child(entry.playerId).child("name").get();
        const fullName = snap.val();
        names[entry.playerId] = fullName ? utilities.shortenedName(fullName) : "Unknown player";
    }));
    return names;
}
