const functions = require("firebase-functions");
const admin = require("firebase-admin");
const index = require("./index");
const utilities = require("./utilities.js");
module.exports.createResultFromSet = createResultFromSet
module.exports.executeUTRUpdate = executeUTRUpdate

async function executeUTRUpdate(requestedGroupId) {
    return await admin.database().ref('member_rankings').once('value', async (snapshot) => {
        const groups = snapshot.val();
        for (const [groupId, group] of Object.entries(groups)) {
            if (groupId == requestedGroupId || requestedGroupId == null) {
                console.log("\n\nCalculating UTRs for group " + groupId);
                for (const [firebaseId, ranking] of Object.entries(group)) {
                    console.log("Existing ranking for " + firebaseId + ": " + JSON.stringify(ranking));
                    let newUtr = await calculateUTR(firebaseId, ranking.utr);
                    if (newUtr == -1) {
                        continue;
                    }
                    admin.database().ref('member_rankings').child(groupId).child(firebaseId).child("utr").set(newUtr)
                }
            }
        }
    });
}

async function calculateUTR(firebaseId, utr) {
    let matchHistorySnapshot = await admin.database().ref('results-v2').child(firebaseId).once('value', async (snapshot) => {
        const data = snapshot.val()
        if (data == null) {
            console.log("No match history found for " + firebaseId)
            return null
        }
        //filter by group?
        //return up to 30 results for this user sorted by most recent
        return Object.values(data).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30)

    })
    let matchHistory = matchHistorySnapshot.val()
    if (matchHistory == null || matchHistory.length == 0) {
        return -1
    }
    let totalRating = 0
    let totalWeight = 0
    for (const [key, match] of Object.entries(matchHistory)) {
        let matchWeight = calculateMatchWeight(match)
        // console.log("matchWeight: " + match.matchWeight)
        totalRating += match.matchRating * matchWeight
        totalWeight += matchWeight

    }
    let utrMultiplier = totalRating / totalWeight
    let baseUtr = 4.0
    let newUtr = parseFloat((baseUtr * utrMultiplier).toFixed(2))
    console.log(baseUtr + "(base) * " + utrMultiplier + "(multiplier)=" + newUtr + "(new utr)")
    return newUtr
}

calculateMatchRating = (victor, winningScore, losingScore, winnerUtr, loserUtr, winnerServedFirst) => {
    let gameDifference = Math.abs(winningScore - losingScore)
    let gameCount = winningScore + losingScore
    const mod = gameCount % 2;
    if (winnerServedFirst && mod == 0) {
        gameDifference = gameDifference + .5
    } else if (!winnerServedFirst && mod == 1) {
        gameDifference = gameDifference - .5
    }
    let playerUtr
    let opponentUtr
    if (victor) {
        playerUtr = winnerUtr
        opponentUtr = loserUtr
    } else {
        playerUtr = loserUtr
        opponentUtr = winnerUtr
    }
    let utrDifference = playerUtr - opponentUtr
    let baseWinnerRating = .9
    let gameFactor = .1
    let utrFactor = .05
    let baseLoserRating = 1.1
    let matchRating
    if (victor) {
        matchRating = baseWinnerRating + ((gameDifference * gameFactor) - (utrDifference * utrFactor))
        // console.log("matchRating for victory: " + matchRating + " game difference: " + gameDifference + " utr difference: " + utrDifference)
    } else {
        matchRating = baseLoserRating - ((gameDifference * gameFactor) + (utrDifference * utrFactor))
        // console.log("matchRating for loss: " + matchRating + " game difference: " + gameDifference + " utr difference: " + utrDifference)
    }
    return matchRating

}

calculateMatchWeight = (match) => {
    let baseWeight = 10
    let baseDecayRate = .03
    let date1 = new Date()
    let date2 = new Date(match.date)
    let utc1 = Date.UTC(date1.getFullYear(), date1.getMonth(), date1.getDate())
    let utc2 = Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate())
    let daysSinceMatch = Math.ceil(Math.abs(utc1 - utc2) / (1000 * 60 * 60 * 24))
    // console.log("daysSinceMatch: " + daysSinceMatch)
    let decayRate = Math.max(0, Math.min(baseDecayRate, 1));
    let weight = baseWeight * Math.pow(1 - decayRate, daysSinceMatch)
    return weight
}

async function createResultFromSet(setId, setData, groupId) {
    console.log("createResultFromSet: " + JSON.stringify(setData));
    await admin.database().ref("member_rankings").once('value', async (snapshot) => {
        const rankings = snapshot.val();
        if (rankings[groupId][setData.winners[0]] == null || rankings[groupId][setData.winners[1]] == null ||
            rankings[groupId][setData.losers[0]] == null || rankings[groupId][setData.losers[1]] == null) {
            console.log("rankings: " + JSON.stringify(rankings[groupId][setData.winners[0]]) + " for " + JSON.stringify(setData.winners[0]));
            console.log("rankings: " + JSON.stringify(rankings[groupId][setData.winners[1]]) + " for " + JSON.stringify(setData.winners[1]));
            console.log("rankings: " + JSON.stringify(rankings[groupId][setData.losers[0]]) + " for " + JSON.stringify(setData.losers[0]));
            console.log("rankings: " + JSON.stringify(rankings[groupId][setData.losers[1]]) + " for " + JSON.stringify(setData.losers[1]));
            console.log("null ranking found");
            return;
        }
        let winnerUtr = (rankings[groupId][setData.winners[0]].utr + rankings[groupId][setData.winners[1]].utr).toFixed(2);
        let loserUtr = (rankings[groupId][setData.losers[0]].utr + rankings[groupId][setData.losers[1]].utr).toFixed(2);

        setData.losers.forEach(loser => {
            let result = createResult(false);
            let pushId = admin.database().ref("results-v2").child(loser).push(result);
            console.log("loser result: " + pushId + " " + JSON.stringify(result));
        });
        setData.winners.forEach(winner => {
            let result = createResult(true);
            let pushId = admin.database().ref("results-v2").child(winner).push(result);
            console.log("winner result: " + pushId + " " + JSON.stringify(result));
        });


        function createResult(victor) {
            const newDate = new Date(setData.weekName);
            newDate.setDate(newDate.getDate() + ((utilities.dayOfWeekAsInteger(setData.dayName) + 6) % 7));
            let result = {
                "setId": setId, "date": utilities.fmt(newDate),
                "timestamp": setData.timestamp,
                "winners": setData.winners, "losers": setData.losers,
                "winningScore": setData.winningScore, "losingScore": setData.losingScore,
                victor: victor, "winnerUtr": winnerUtr, "loserUtr": loserUtr, "group": groupId,
                "matchRating": calculateMatchRating(victor, setData.winningScore, setData.losingScore, winnerUtr, loserUtr, setData.winnersServedFirst),
            };
            return result;
        }
    });
}