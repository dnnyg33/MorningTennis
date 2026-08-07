/**
 * Ladder points formula.
 *
 * Implements the three-tier system:
 *   1. Borrowed points  -- optional initial seeding that decays to zero over the
 *                          first few weeks. Standings only; not part of a match award.
 *   2. Base points       -- the 39-point pot split by games (and tiebreak points).
 *   3. Rank distance     -- adjusts the WINNER only, by the rank gap.
 *
 * On top of those sits the balls adjustment: a flat award for supplying the
 * balls, or a flat forfeit for keeping a can you didn't earn. See
 * [ballAdjustment].
 *
 * This module is the ONLY place points math lives, so the formula can be changed
 * in one file. `ladder.js` (standings) never computes points; it reads stored
 * tallies. Bump FORMULA_VERSION whenever the math changes, and stamp it onto each
 * scored match, so a future rescore can tell which rules produced which award.
 */

const FORMULA_VERSION = 3;

/**
 * Tunables, kept as data rather than inline literals.
 *
 * `pot` is the fixed number of base points shared between the two players: the
 * loser earns their games (and tiebreak share), the winner gets the rest.
 */
const CONFIG = {
    pot: 39,
    // Loser's tiebreak share: points won / divisor, rounded up, capped.
    tiebreakDivisor: 2,
    tiebreakCap: 6,
    // Winner's rank-distance adjustment, per rank of separation.
    penaltyPerRankAbove: 2, // winner ranked ABOVE the loser forfeits points
    bonusPerRankBelow: 3,   // winner ranked BELOW the loser earns points
    // The winner's final award is always within these bounds.
    minWinnerAward: 12,
    maxWinnerAward: 55,
    // Bringing the balls when your opponent didn't, or keeping a new can you
    // didn't earn. Awarded and forfeited at the same rate.
    ballPoints: 3,
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * The loser's base points: one point per game won in ordinary sets, plus a
 * capped share of any tiebreak-set points.
 *
 * A tiebreak set (isTiebreak) carries tiebreak POINTS in its game fields, not
 * games -- e.g. a 10-7 champions tiebreak. The loser's 7 points there count as
 * ceil(7 / 2) = 4, capped at 6. The winner's side of the pot is whatever's left,
 * so we never compute the winner's games directly.
 *
 * @param {Array<{loserGames:number, isTiebreak?:boolean}>} sets  Winner-perspective sets.
 * @return {number} Integer base points for the loser.
 */
function loserBasePoints(sets) {
    return sets.reduce((total, set) => {
        if (set.isTiebreak === true) {
            const share = Math.ceil(set.loserGames / CONFIG.tiebreakDivisor);
            return total + Math.min(CONFIG.tiebreakCap, share);
        }
        return total + set.loserGames;
    }, 0);
}

/**
 * The winner's rank-distance adjustment.
 *
 * Ranks are 1-based and lower is better. A winner ranked above the loser
 * (smaller rank number) forfeits points; a winner ranked below the loser earns
 * them. The adjustment is applied to the winner's base, then clamped by the
 * caller. Losers never receive a distance adjustment.
 *
 * @return {number} Signed points to add to the winner's base (negative = penalty).
 */
function rankDistanceAdjustment(winnerRank, loserRank) {
    const gap = Math.abs(winnerRank - loserRank);
    if (winnerRank < loserRank) return -gap * CONFIG.penaltyPerRankAbove;
    if (winnerRank > loserRank) return gap * CONFIG.bonusPerRankBelow;
    return 0;
}

/**
 * Who supplied the balls, worth a flat CONFIG.ballPoints either way.
 *
 * The reporter answers two questions on the form: whether both players brought
 * balls, and then either who did bring them or where the unopened can ended up.
 *
 *   - both brought, winner kept the new can -- square; nobody is owed anything
 *   - both brought, loser kept it           -- the loser forfeits ballPoints
 *   - one brought them                      -- that player earns ballPoints,
 *                                              whether they won or lost
 *
 * Missing or incomplete answers (a client older than the question, or a match
 * reported before it existed) score nothing rather than guessing.
 *
 * @param {object} args
 * @param {{bothBrought?:boolean, winnerKeptNewCan?:boolean, broughtBy?:string}|null} args.balls
 * @param {string} args.winnerId
 * @param {string} args.loserId
 * @return {{winner:number, loser:number}} Signed points to add to each side.
 */
function ballAdjustment({ balls, winnerId, loserId }) {
    const none = { winner: 0, loser: 0 };
    if (balls == null) return none;

    if (balls.bothBrought === true) {
        // The new can goes home with the winner. A loser who takes it pays for it.
        return balls.winnerKeptNewCan === false
            ? { winner: 0, loser: -CONFIG.ballPoints }
            : none;
    }

    if (balls.bothBrought === false) {
        if (balls.broughtBy === winnerId) return { winner: CONFIG.ballPoints, loser: 0 };
        if (balls.broughtBy === loserId) return { winner: 0, loser: CONFIG.ballPoints };
    }

    return none;
}

/**
 * Points for both sides of a confirmed match.
 *
 * @param {object} match
 * @param {number} match.winnerRank  Winner's rank before the match (1-based, lower is better).
 * @param {number} match.loserRank   Loser's rank before the match (1-based, lower is better).
 * @param {Array<{winnerGames:number, loserGames:number, isTiebreak?:boolean}>} match.sets
 *        Sets from the WINNER's perspective.
 * @param {object} [match.balls]     The reporter's ball answers -- see [ballAdjustment].
 * @param {string} [match.winnerId]  Needed only to read `balls.broughtBy`.
 * @param {string} [match.loserId]   Needed only to read `balls.broughtBy`.
 * @return {{
 *   winnerPoints:number, loserPoints:number,
 *   winnerBase:number, loserBase:number, distanceAdjustment:number,
 *   ballAdjustment:{winner:number, loser:number},
 *   formulaVersion:number
 * }}
 */
function scoreMatch({ winnerRank, loserRank, sets, balls = null, winnerId, loserId }) {
    const loserBase = loserBasePoints(sets);
    const winnerBase = CONFIG.pot - loserBase;
    const distanceAdjustment = rankDistanceAdjustment(winnerRank, loserRank);
    const ballPoints = ballAdjustment({ balls, winnerId, loserId });

    return {
        // The balls award sits OUTSIDE the clamp on purpose: the bounds exist to
        // keep the rank-distance swing sane, and swallowing a bonus somebody
        // earned by turning up with balls would make the answer meaningless.
        winnerPoints: clamp(
            winnerBase + distanceAdjustment,
            CONFIG.minWinnerAward,
            CONFIG.maxWinnerAward,
        ) + ballPoints.winner,
        // The loser always keeps their base points -- no distance, no clamp. The
        // balls forfeit can take this below zero, which is the point of it.
        loserPoints: loserBase + ballPoints.loser,
        winnerBase,
        loserBase,
        distanceAdjustment,
        ballAdjustment: ballPoints,
        formulaVersion: FORMULA_VERSION,
    };
}

/**
 * A player's CURRENT borrowed points, given linear weekly decay.
 *
 * Borrowed points seed the ladder so similar players start near each other, then
 * bleed off evenly over the first few weeks until only earned points remain. A
 * 300-point, 6-week seed loses 50 each week: 300, 250, ... 0.
 *
 * Pure and defensive: clamps to [0, initial], treats a missing/zero seed or a
 * non-positive decay window as "no borrowed points". Fractional `weeksElapsed`
 * is fine -- the client can pass elapsed-days / 7 for a smooth curve.
 *
 * @param {object} args
 * @param {number} args.initial       Borrowed points at week 0.
 * @param {number} args.decayWeeks    Weeks over which they fall to zero.
 * @param {number} args.weeksElapsed  Whole or fractional weeks since the season start.
 * @return {number} Remaining borrowed points (not rounded; round at display time).
 */
function currentBorrowedPoints({ initial, decayWeeks, weeksElapsed }) {
    if (!(initial > 0) || !(decayWeeks > 0)) return 0;
    const remaining = initial * (1 - weeksElapsed / decayWeeks);
    return clamp(remaining, 0, initial);
}

module.exports = {
    FORMULA_VERSION,
    CONFIG,
    scoreMatch,
    loserBasePoints,
    rankDistanceAdjustment,
    ballAdjustment,
    currentBorrowedPoints,
};
