const admin = require("firebase-admin");
const ladder = require("./ladder.js");

module.exports.reportLadderMatch = reportLadderMatch;
module.exports.deleteLadderMatch = deleteLadderMatch;
module.exports.disputeLadderMatch = disputeLadderMatch;
module.exports.withdrawLadderMatch = withdrawLadderMatch;
module.exports.validateSets = validateSets;
module.exports.summarizeSets = summarizeSets;

// Realtime Database paths.
const LADDER_MATCHES = "ladder_matches"; // ladder_matches/{groupId}/{seasonId}/{matchId}
const GROUPS = "groups-v2";
const USERS = "approvedNumbers";
const MEMBER_RANKINGS = "member_rankings"; // member_rankings/{groupId}/{firebaseId}/suspended

const MAX_SETS = 5;

// Ladder play is switched on per group by us, at groups-v2/{groupId}/ladderEnabled.
// A group can set a season up before then, but nothing may be written to the log
// until the flag is flipped -- the app says the same on its Ladder tab.
const LADDER_DISABLED_ERROR =
    "Ladder play isn't active for this group yet. Contact support@tengentllc.com to have it enabled.";

/**
 * POST /v1/reportLadderMatch
 * body: { id, groupId, seasonId, reportedBy, opponentId, sets, timestamp }
 *
 * Rejected outright unless the group's ladder has been switched on -- see
 * [ladderIsEnabled]. Every other write here is gated the same way.
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

        if (!ladderIsEnabled(group)) {
            res.status(403).send({ error: LADDER_DISABLED_ERROR });
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

            const [reporterIsMember, opponentIsMember, opponentSuspended] = await Promise.all([
                isGroupMember(reportedBy, groupId),
                isGroupMember(opponentId, groupId),
                isSuspended(opponentId, groupId),
            ]);
            if (!reporterIsMember) {
                res.status(403).send({ error: "You're not a member of that group." });
                return;
            }
            if (!opponentIsMember) {
                res.status(400).send({ error: "Your opponent isn't a member of that group." });
                return;
            }
            // A suspended player can't appear in a result at all, so a new match
            // can't be reported against one.
            if (opponentSuspended) {
                res.status(400).send({ error: "Your opponent's account is inactive in this group, so you can't report a match against them." });
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
        // Read before the "already deleted" shortcut: a locked ladder should say
        // it's locked rather than report a deletion it would never have allowed.
        const group = await fetchGroup(groupId);
        if (!ladderIsEnabled(group)) {
            res.status(403).send({ error: LADDER_DISABLED_ERROR });
            return;
        }

        const ref = admin.database().ref(LADDER_MATCHES).child(groupId).child(seasonId).child(matchId);
        const existing = (await ref.get()).val();

        if (existing == null) {
            const rows = await ladder.buildStandings(groupId, seasonId);
            res.status(200).send({ data: { result: "already_deleted", standings: { seasonId, rows } } });
            return;
        }

        if (await isSuspended(userId, groupId)) {
            res.status(403).send({ error: "Your account is inactive in this group, so you can't change ladder matches." });
            return;
        }

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
 * POST /v1/disputeLadderMatch
 * body: { matchId, groupId, disputedBy, reason }
 *
 * Puts a reported result on hold. The match stays in the log but carries a
 * `contestation`, and the standings replay skips contested matches (see
 * ladder.js), so the points come back off until it's resolved -- withdrawn by
 * the reporter or the score re-reported.
 */
async function disputeLadderMatch(req, res) {
    const body = req.body || {};
    const { groupId, matchId, disputedBy, reason } = body;

    if (!groupId || !matchId || !disputedBy) {
        res.status(400).send({ error: "A group, a match, and who's contesting it are all required." });
        return;
    }

    try {
        if (!ladderIsEnabled(await fetchGroup(groupId))) {
            res.status(403).send({ error: LADDER_DISABLED_ERROR });
            return;
        }

        if (await isSuspended(disputedBy, groupId)) {
            res.status(403).send({ error: "Your account is inactive in this group, so you can't contest ladder matches." });
            return;
        }

        const found = await findMatch(groupId, matchId);
        if (found == null) {
            res.status(404).send({ error: "We couldn't find that match." });
            return;
        }

        const { ref, seasonId, match } = found;
        // Only a player in the match may contest it.
        if (disputedBy !== match.reportedBy && disputedBy !== match.opponentId) {
            res.status(403).send({ error: "Only a player in this match can contest it." });
            return;
        }

        await ref.child("contestation").set({
            isContested: true,
            dateContested: Date.now(),
            contestedBy: disputedBy,
            reason: typeof reason === "string" && reason.trim() !== "" ? reason : null,
        });

        const rows = await ladder.buildStandings(groupId, seasonId);
        res.status(200).send({
            data: {
                result: "contested",
                standings: { seasonId, rows },
            },
        });
    } catch (e) {
        console.error("disputeLadderMatch error", e);
        res.status(500).send({ error: "We couldn't contest that match. Please try again." });
    }
}

/**
 * POST /v1/withdrawLadderMatch
 * body: { matchId, groupId, userId }
 *
 * Resolves a contested match by taking it out of the log -- a group admin only,
 * since it removes another player's result. Only a match that's actually on hold
 * can be withdrawn; an uncontested one is removed through deleteLadderMatch. The
 * next standings read replays what's left.
 */
async function withdrawLadderMatch(req, res) {
    const body = req.body || {};
    const { groupId, matchId, userId } = body;

    if (!groupId || !matchId || !userId) {
        res.status(400).send({ error: "A group, a match, and who's withdrawing it are all required." });
        return;
    }

    try {
        const group = await fetchGroup(groupId);
        if (!ladderIsEnabled(group)) {
            res.status(403).send({ error: LADDER_DISABLED_ERROR });
            return;
        }
        if (!isAdmin(group, userId)) {
            res.status(403).send({ error: "Only a group admin can withdraw a contested match." });
            return;
        }

        const found = await findMatch(groupId, matchId);
        if (found == null) {
            // Already gone -- report the current board rather than an error.
            res.status(200).send({ data: { result: "already_withdrawn" } });
            return;
        }

        const { ref, seasonId, match } = found;
        if (match.contestation == null || match.contestation.isContested !== true) {
            res.status(400).send({ error: "Only a contested match can be withdrawn." });
            return;
        }

        await ref.remove();

        const rows = await ladder.buildStandings(groupId, seasonId);
        res.status(200).send({
            data: {
                result: "withdrawn",
                matchId,
                standings: { seasonId, rows },
            },
        });
    } catch (e) {
        console.error("withdrawLadderMatch error", e);
        res.status(500).send({ error: "We couldn't withdraw that match. Please try again." });
    }
}

/**
 * Finds a match by id without knowing its season, by scanning the group's
 * seasons. Returns { ref, seasonId, match }, or null when there's no such match.
 * The dispute/withdraw endpoints take only a matchId, so this locates it.
 */
async function findMatch(groupId, matchId) {
    const seasons = (await admin.database().ref(LADDER_MATCHES).child(groupId).get()).val();
    if (seasons == null) return null;
    for (const [seasonId, matches] of Object.entries(seasons)) {
        if (matches != null && Object.prototype.hasOwnProperty.call(matches, matchId)) {
            return {
                seasonId,
                match: matches[matchId],
                ref: admin.database().ref(LADDER_MATCHES).child(groupId).child(seasonId).child(matchId),
            };
        }
    }
    return null;
}

/**
 * Who may edit or delete a match: either player in it, or a group admin.
 */
function canManage(match, userId, group) {
    if (userId === match.reportedBy || userId === match.opponentId) return true;
    return isAdmin(group, userId);
}

/**
 * Whether we've switched ladder play on for this group. Absent means off, so
 * every group starts with the ladder locked until the flag is set by hand.
 */
function ladderIsEnabled(group) {
    return group?.ladderEnabled === true;
}

/**
 * The group record, or null when there's no such group.
 */
async function fetchGroup(groupId) {
    return (await admin.database().ref(GROUPS).child(groupId).get()).val();
}

/**
 * Whether userId is a group admin. Admins live at groups-v2/{groupId}/admins.
 */
function isAdmin(group, userId) {
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
