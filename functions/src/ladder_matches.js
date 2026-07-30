const admin = require("firebase-admin");
const ladder = require("./ladder.js");

module.exports.reportLadderMatch = reportLadderMatch;
module.exports.deleteLadderMatch = deleteLadderMatch;
module.exports.validateSets = validateSets;
module.exports.summarizeSets = summarizeSets;

// Realtime Database paths.
const LADDER_MATCHES = "ladder_matches"; // ladder_matches/{groupId}/{seasonId}/{matchId}
const GROUPS = "groups-v2";
const USERS = "approvedNumbers";
const MEMBER_RANKINGS = "member_rankings"; // member_rankings/{groupId}/{firebaseId}/suspended

const MAX_SETS = 5;

/**
 * POST /v1/reportLadderMatch
 * body: { id, groupId, seasonId, reportedBy, opponentId, sets, timestamp }
 *
 * Records a match and applies its points immediately -- no approval step. Because
 * standings are a pure replay of the match log (see ladder.js), "applying" a
 * match is just writing it: the next standings read scores it in context.
 *
 * Upsert keyed on `id`:
 *   - id absent/null -> create a new match (both players must be group members).
 *   - id present      -> edit that match's score. Only a participant or a group
 *                        admin may edit, and the score is re-validated. Every
 *                        later match is automatically re-scored on the next read.
 */
async function reportLadderMatch(req, res) {
    const body = req.body || {};
    const { groupId, seasonId, reportedBy, opponentId, sets, timestamp } = body;
    const editingId = body.id ?? null;

    if (!groupId || !seasonId || !reportedBy || !opponentId) {
        res.status(400).send({ error: "A group, a ladder season, and both players are required to report a match." });
        return;
    }
    if (reportedBy === opponentId) {
        res.status(400).send({ error: "You can't report a match against yourself." });
        return;
    }

    const setsError = validateSets(sets);
    if (setsError != null) {
        res.status(400).send({ error: setsError });
        return;
    }

    const summary = summarizeSets(sets);
    if (summary.winnerIsReporter == null) {
        res.status(400).send({ error: "This match doesn't have a winner. Report the score once the match is finished." });
        return;
    }

    try {
        const group = (await admin.database().ref(GROUPS).child(groupId).get()).val();
        if (group == null) {
            res.status(404).send({ error: "We couldn't find that group." });
            return;
        }

        // A suspended member can't touch the ladder -- neither reporting a new
        // match nor editing an old one -- so the suspension actually holds.
        if (await isSuspended(reportedBy, groupId)) {
            res.status(403).send({ error: "Your account is inactive in this group, so you can't report ladder matches." });
            return;
        }

        const seasonRef = admin.database().ref(LADDER_MATCHES).child(groupId).child(seasonId);

        let ref;
        let reportedAt = Date.now();
        if (editingId != null) {
            // Editing an existing match.
            ref = seasonRef.child(editingId);
            const existing = (await ref.get()).val();
            if (existing == null) {
                res.status(404).send({ error: "We couldn't find the match you're trying to edit." });
                return;
            }
            if (!canManage(existing, reportedBy, group)) {
                res.status(403).send({ error: "Only a player in this match or a group admin can edit it." });
                return;
            }
            reportedAt = existing.reportedAt ?? reportedAt;
        } else {
            // New match. Enforce the running season and group membership only on
            // create -- an edit of an old match must stay possible after the
            // season ends or a player leaves.
            const currentSeason = group.ladderSeason;
            if (currentSeason == null || currentSeason.id !== seasonId) {
                res.status(400).send({ error: "That ladder season isn't running for this group." });
                return;
            }
            if (currentSeason.endTimestamp != null && Date.now() > currentSeason.endTimestamp) {
                res.status(400).send({ error: "That ladder season has ended." });
                return;
            }

            const [reporterIsMember, opponentIsMember] = await Promise.all([
                isGroupMember(reportedBy, groupId),
                isGroupMember(opponentId, groupId),
            ]);
            if (!reporterIsMember) {
                res.status(403).send({ error: "You're not a member of that group." });
                return;
            }
            if (!opponentIsMember) {
                res.status(400).send({ error: "Your opponent isn't a member of that group." });
                return;
            }

            ref = seasonRef.push();
        }

        const winnerId = summary.winnerIsReporter ? reportedBy : opponentId;
        const loserId = summary.winnerIsReporter ? opponentId : reportedBy;

        const match = {
            id: ref.key,
            groupId,
            seasonId,
            reportedBy,
            opponentId,
            sets: summary.sets,
            winnerId,
            loserId,
            reporterSetsWon: summary.reporterSets,
            opponentSetsWon: summary.opponentSets,
            reporterGamesWon: summary.reporterGames,
            opponentGamesWon: summary.opponentGames,
            // When the match was played, per the client. Falls back to now so a
            // record always has a time to sort the replay by.
            timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
            reportedAt,
            updatedAt: Date.now(),
        };

        await ref.set(match);

        // Return the freshly replayed standings so the client can render the new
        // board without a second round trip.
        const rows = await ladder.buildStandings(groupId, seasonId);
        res.status(200).send({
            data: {
                result: editingId != null ? "updated" : "success",
                match,
                standings: { seasonId, rows },
            },
        });
    } catch (e) {
        console.error("reportLadderMatch error", e);
        res.status(500).send({ error: "We couldn't report that match. Please try again." });
    }
}

/**
 * DELETE via POST /v1/deleteLadderMatch
 * body: { groupId, seasonId, matchId, userId }
 *
 * Removes a match from the log. The next standings read simply replays what's
 * left, so every later match is re-scored correctly with the deleted one gone.
 * Idempotent: deleting an already-gone match still returns the current standings.
 */
async function deleteLadderMatch(req, res) {
    const body = req.body || {};
    const { groupId, seasonId, matchId, userId } = body;

    if (!groupId || !seasonId || !matchId || !userId) {
        res.status(400).send({ error: "A group, season, match, and user are all required to delete a match." });
        return;
    }

    try {
        const ref = admin.database().ref(LADDER_MATCHES).child(groupId).child(seasonId).child(matchId);
        const existing = (await ref.get()).val();

        if (existing == null) {
            const rows = await ladder.buildStandings(groupId, seasonId);
            res.status(200).send({ data: { result: "already_deleted", standings: { seasonId, rows } } });
            return;
        }

        const group = (await admin.database().ref(GROUPS).child(groupId).get()).val();
        if (!canManage(existing, userId, group)) {
            res.status(403).send({ error: "Only a player in this match or a group admin can delete it." });
            return;
        }

        await ref.remove();

        const rows = await ladder.buildStandings(groupId, seasonId);
        res.status(200).send({
            data: {
                result: "deleted",
                matchId,
                standings: { seasonId, rows },
            },
        });
    } catch (e) {
        console.error("deleteLadderMatch error", e);
        res.status(500).send({ error: "We couldn't delete that match. Please try again." });
    }
}

/**
 * Who may edit or delete a match: either player in it, or a group admin.
 */
function canManage(match, userId, group) {
    if (userId === match.reportedBy || userId === match.opponentId) return true;
    const admins = group?.admins;
    return admins != null && Object.values(admins).includes(userId);
}

/**
 * Membership lives on the user, not the group: approvedNumbers/{uid}/groups.
 */
async function isGroupMember(playerId, groupId) {
    const snap = await admin.database().ref(USERS).child(playerId).child("groups").get();
    const groups = snap.val();
    if (groups == null) return false;
    return Object.values(groups).includes(groupId);
}

/**
 * Whether an admin has suspended this player in the group. The flag lives on the
 * member ranking: member_rankings/{groupId}/{playerId}/suspended, set by
 * modifyGroupMember. Absent means not suspended.
 */
async function isSuspended(playerId, groupId) {
    const snap = await admin.database().ref(MEMBER_RANKINGS).child(groupId).child(playerId).child("suspended").get();
    return snap.val() === true;
}

/**
 * Rejects scores that can't have happened, so the ladder never scores a match
 * that wasn't played out. Returns an error string, or null when the sets are fine.
 *
 * A set is valid when it is one of:
 *   - 6-0 .. 6-4        won by two clear games
 *   - 7-5, 7-6          the extended set and its tiebreak
 *   - a tiebreak set    (isTiebreak) won by 7+ with a 2 point margin -- covers
 *                       both the 7-point and 10-point conventions
 */
function validateSets(sets) {
    if (!Array.isArray(sets) || sets.length === 0) {
        return "A match needs at least one set.";
    }
    if (sets.length > MAX_SETS) {
        return `A match can't have more than ${MAX_SETS} sets.`;
    }

    for (let i = 0; i < sets.length; i++) {
        const set = sets[i];
        const reporterGames = set?.reporterGames;
        const opponentGames = set?.opponentGames;

        if (!Number.isInteger(reporterGames) || !Number.isInteger(opponentGames) ||
            reporterGames < 0 || opponentGames < 0) {
            return `Set ${i + 1} needs a score for both players.`;
        }

        const high = Math.max(reporterGames, opponentGames);
        const low = Math.min(reporterGames, opponentGames);
        const label = `${reporterGames}-${opponentGames} isn't a completed set`;

        if (set.isTiebreak === true) {
            if (high < 7 || high - low < 2) {
                return `Set ${i + 1}: ${label}. A tiebreak is won by two points.`;
            }
            continue;
        }

        const isStandard = high === 6 && low <= 4;
        const isExtended = high === 7 && (low === 5 || low === 6);
        if (!isStandard && !isExtended) {
            return `Set ${i + 1}: ${label}.`;
        }
    }

    return null;
}

/**
 * Totals the sets and decides the match.
 *
 * `winnerIsReporter` is null when the sets are level -- an unfinished match that
 * the caller must reject rather than score.
 */
function summarizeSets(sets) {
    let reporterSets = 0;
    let opponentSets = 0;
    let reporterGames = 0;
    let opponentGames = 0;

    const normalized = sets.map((set) => {
        if (set.reporterGames > set.opponentGames) reporterSets++;
        else opponentSets++;
        reporterGames += set.reporterGames;
        opponentGames += set.opponentGames;
        return {
            reporterGames: set.reporterGames,
            opponentGames: set.opponentGames,
            isTiebreak: set.isTiebreak === true,
        };
    });

    return {
        sets: normalized,
        reporterSets,
        opponentSets,
        reporterGames,
        opponentGames,
        winnerIsReporter: reporterSets === opponentSets ? null : reporterSets > opponentSets,
    };
}
