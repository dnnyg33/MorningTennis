
module.exports.runSort = runSort;
const admin = require("firebase-admin");
const v3 = require('./sorting-v3.js')

async function runSort(incomingSubmissionsData, groupId, weekName) {
    admin.database().ref('groups-v2').child(groupId).child("scheduleIsBuilding").set(true);

    const memberRankingsSnapshot = await admin.database().ref('member_rankings').child(groupId).get();
    const result = tennisSortBySkill(incomingSubmissionsData, memberRankingsSnapshot.val())
    admin.database().ref("sorted-v4").child(groupId).child(weekName).set(result)
    return result
}

function Combinations(arr, r) {
    // To avoid object referencing, cloning the array.
    arr = arr && arr.slice() || [];

    var len = arr.length;

    if (!len || r > len || !r)
        return [[]];
    else if (r === len)
        return [arr];

    if (r === len) return arr.reduce((x, v) => {
        x.push([v]);

        return x;
    }, []);

    var head = arr.shift();

    return Combinations(arr, r - 1).map(x => {
        x.unshift(head);

        return x;
    }).concat(Combinations(arr, r));
}


function tennisSortBySkill(data, playerInfoMap) {
    console.log("playerInfoMap: " + JSON.stringify(playerInfoMap))
    let uniqueData = v3.removeDuplicates(data)
    console.log("Unique Data: " + JSON.stringify(uniqueData))
    //make a map for each day with key as name of day
    const daysAvailable = {}

    for (const [key, playerSubmission] of Object.entries(uniqueData)) {
        //for each nonnull choice, add item to map using choice as key
        // console.log("item: " + JSON.stringify(item))
        const choices = playerSubmission.choices;
        for (let index = 0; index < choices.length; index++) {
            const choice = choices[index];
            addChoiceToDay(playerSubmission, choice)
        }
    }
    // console.log(JSON.stringify(daysAvailable))


    function addChoiceToDay(playerSubmission, key) {
        console.log("playerInfoMap: " + JSON.stringify(playerInfoMap))
        const ranking = playerInfoMap[playerSubmission.phoneNumber]
        let utr = 40
        let goodwill = 1
        if (ranking != null) {
            utr = ranking.utr
            ranking.goodwill
        }
        daysAvailable[key] = daysAvailable[key] ?? [];
        daysAvailable[key].push({ "name": playerSubmission.name, "phoneNumber": playerSubmission.phoneNumber, "maxDays": playerSubmission.maxDays, "utr": utr, "goodwill": goodwill });
    }

    const weeklyMatches = {}
    while (Object.keys(daysAvailable).length > 0) {
        const topComboOfWeek = findBestMatches(daysAvailable);
        if (topComboOfWeek == undefined) {
            break;
        }
        const key = Object.keys(topComboOfWeek)[0]
        delete daysAvailable[key]
        Object.assign(weeklyMatches, topComboOfWeek)
        // topComboOfWeek[key].players.length
        reduceGoodwillForChosenPlayers(topComboOfWeek, key);
    }


    for (const [key, item] of Object.entries(weeklyMatches)) {
        console.log(key + "-" + getPlayerSummary(item.players)
            + " \n " + JSON.stringify(item.stats))
    }
    return weeklyMatches;


    function reduceGoodwillForChosenPlayers(topComboOfWeek, key) {
        let upperBound = topComboOfWeek[key].players.length < 4 ? topComboOfWeek[key].players.length : 4
        for (let index = 0; index < upperBound; index++) {
            const chosenPlayer = topComboOfWeek[key].players[index];
            for (const [key, day] of Object.entries(daysAvailable)) {
                var playerCount = 0;
                for (const [key, player] of Object.entries(day)) {
                    if (player.phoneNumber === chosenPlayer.phoneNumber) {
                        player.maxDays = chosenPlayer.maxDays - 1;
                        if (player.maxDays == 0) {
                            player.goodwill = 0;
                        } else {
                            player.goodwill = (player.goodwill) / 2;
                        }
                        console.log(chosenPlayer.name + " goodwill reduced by half");
                    }
                }
            }
        }
    }

    function findBestMatches(daysAvailable) {

        const allCombos = new Map();
        //find all combinations for each day
        for (const [key, allPlayers] of Object.entries(daysAvailable)) {//daysAvailable = {"Monday": [{name: "5412078581", "utr": 5.5}]}
            var combos
            if (allPlayers.length < 4) {
                allPlayers.forEach(x => {
                    if (x.name.substring(0, 1) != "(") {
                        x.name = "(" + x.name + ")"
                    }
                })
                combos = [allPlayers]
            } else {
                combos = Combinations(allPlayers, 4); //item = {name: "5412078581", "utr": 5.5}
            }
            allCombos.set(key, sortCombosByHighestQuality(combos, allPlayers)); //allCombos = {"Monday": [{"1,4,2,3"}, {"1,3,2,5"}], "Tuesday"...}
        }

        var topComboOfWeek; // {"Monday": {"1,4,2,3"}}
        var topComboOfWeekKey;
        for (const [key, dayCombos] of allCombos) {
            const topComboPerDay = dayCombos[0];
            if (topComboOfWeek == undefined) {
                topComboOfWeek = { [key]: topComboPerDay }
                topComboOfWeekKey = key
            }
            else if (topComboPerDay.stats.quality > topComboOfWeek[topComboOfWeekKey].stats.quality) {
                topComboOfWeek = { [key]: topComboPerDay };
                topComboOfWeekKey = key
            }
        }

        return topComboOfWeek
    }

}

function sortCombosByHighestQuality(combinations, allSignupsForDay) {
    var matchesByQuality = [];
    for (let index = 0; index < combinations.length; index++) {
        const players = combinations[index];
        //if less than 4 players for a day, then there are no combos to sort
        if (players.length < 4) {
            matchesByQuality.push({ "players": players, stats: { "quality": -1, "closeness": 0, "balance": 0, "bias": 0 } })
        } else {
            let alternates = allSignupsForDay.filter(x => !players.includes(x))
            const sortedPlayers = players.sortBy(i => i.utr);
            sortedPlayers.push.apply(sortedPlayers, alternates)
            const teamAutr = sortedPlayers[0].utr + sortedPlayers[3].utr
            const teamButr = sortedPlayers[1].utr + sortedPlayers[2].utr
            const balance = outOfPossible(13, Math.abs(teamAutr - teamButr))
            const closeness = outOfPossible(15, calculateCloseness(sortedPlayers))
            const bias = (sortedPlayers[0].goodwill + sortedPlayers[1].goodwill + sortedPlayers[2].goodwill + sortedPlayers[3].goodwill) / 4
            const quality = (balance + closeness) * bias
            matchesByQuality.push({ "players": sortedPlayers, stats: { "quality": quality, "closeness": closeness, "balance": balance, "bias": bias } })
        }
    }
    return matchesByQuality.sortBy(i => i.stats.quality);

    function calculateCloseness(array) {
        return ((array[0].utr + array[1].utr + array[2].utr + array[3].utr) / 4) - array[3].utr

    }

    function outOfPossible(possible, actual) {
        const outOf10 = possible - actual
        if (outOf10 <= 0) {
            return 1
        } else return outOf10 / (possible / 10)
    }

}
function getPlayerSummary(element) {
    if (element.length < 4) return ""
    return element[0].name + "+" + element[3].name + " vs. " + element[1].name + "+" + element[2].name
}