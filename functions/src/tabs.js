const admin = require("firebase-admin");

async function generateTabReport(startDate, endDate, groupId, sortingAlgorithm, playerIndexBound = 4) {
    //looked through sorted schedules between dates and aggregate number of times first 4 players are listed with rsvp yes
    const weeks = await getFilteredWeeks(groupId, sortingAlgorithm, startDate, endDate);
    console.log("generateTabReport weeks:", Object.keys(weeks));
    const playerStats = {};
    let totalCount = 0;
    for (const [weekDate, days] of Object.entries(weeks)) {
        for (const [dayName, dayData] of Object.entries(days)) {
            // Check if dayData has players
            if (dayData && dayData.players) {
                // Iterate through each player in the day
                for (const [playerIndex, player] of Object.entries(dayData.players)) {
                    // Aggregate player data for each day
                    if (player.isComing !== false && playerIndex < playerIndexBound) { // Only count if RSVP is yes and index is 0-3
                        if (!playerStats[player.firebaseId]) {
                            playerStats[player.firebaseId] = { name: player.name, count: 0 };
                        }
                        playerStats[player.firebaseId].count++;
                        totalCount++;
                    }
                }
            }
        }
    }
    const report = {
        "weeksIncluded": Object.keys(weeks),
        "playerStats": playerStats,
        "allPlayers": totalCount
    };
    return report;
}


async function getFilteredWeeks(groupId, sortingAlgorithm, startDate, endDate) {
    const schedulesSnap = await admin.database().ref("sorted-v6").child(groupId).child(sortingAlgorithm).get();
    console.log("generateTabReport.ref " + (schedulesSnap.ref.toString()));
    const allSchedules = schedulesSnap.val() || {};


    // Parse the date range
    const start = new Date(startDate);
    const end = new Date(endDate ? endDate : Date.now());

    // Filter weeks that fall within the date range
    const filteredWeeks = {};
    for (const weekDate in allSchedules) {
        // Parse weekDate format: "Monday-1-13-2025" -> month: 1, day: 13, year: 2025
        const parts = weekDate.split('-');
        if (parts.length >= 4) {
            const month = parseInt(parts[1]) - 1; // JavaScript months are 0-indexed
            const day = parseInt(parts[2]);
            const year = parseInt(parts[3]);
            const weekDateObj = new Date(year, month, day);

            // Check if week date is within range
            if (weekDateObj >= start && weekDateObj <= end) {
                filteredWeeks[weekDate] = allSchedules[weekDate];
            }
        }
    }


    // TODO: Aggregate player data from filtered weeks
    return filteredWeeks;
}

module.exports = {
    generateTabReport
};