
const admin = require("firebase-admin");
module.exports.runSort = runSort;
const index = require('./index.js')

async function runSort(original, groupId, weekName) {
    var groups = await tennisSort(original, groupId)
    admin.database().ref("sorted-v3").child(groupId).child(weekName).set(groups)
    admin.database().ref("sorted-v6").child(groupId).child("timePreference").child(weekName).set(groups)
    const v5Result = index.removeEmptyDays(groups)
    admin.database().ref("sorted-v5").child(groupId).child("timePreference").child(weekName).set(v5Result)

    return groups;
}

async function tennisSort(data, groupId) {
    console.log("tennisSort")
    console.log(JSON.stringify(data))
    let uniqueData = index.removeDuplicates(data)

    var playerCount = 0
    let sortedListsMap = {}

    for (const [key, item] of Object.entries(uniqueData)) {
        playerCount++
        if (item.choices == undefined) {
            console.log(`Skipping ${item.firebaseId} because they have no choices`)
            continue
        }
        for (let index = 0; index < item.choices.length; index++) {
            const choice = item.choices[index].trim();
            const listName = "sorted" + index
            const list = sortedListsMap[listName] ?? []
            const object = buildSortedObjectFull(choice, item, index + 1)
            if (index % 2 == 0) {
                list.push(object)
            } else {
                list.unshift(object)
            }
            sortedListsMap[listName] = list
        }
    }


    let sortedList = [];
    for (const [key, list] of Object.entries(sortedListsMap)) {
        sortedList = sortedList.concat(list)
    }

    let daysMap = {}
    return await index.buildDynamicDaysMap(groupId).then((map) => {
        daysMap = map;
        console.log("TP Days Map: " + JSON.stringify(daysMap))

        sortedList.forEach(playerPreference => {
            let person = uniqueData.find(x => x.firebaseId == playerPreference.firebaseId)
            let hasReachedMaxDays = person.maxDays == person.scheduledDays
            if (hasReachedMaxDays) {
                console.log("skipping " + person.name + " who is already scheduled for " + person.scheduledDays + " days")
                return
            }

            let playerCountForDay = 8
            let addedAsAlternate = false
            let day = daysMap[playerPreference.day] ?? { "players": [] }
            let players = day.players ?? []
            players.push(buildSortedObject(playerPreference))
            daysMap[playerPreference.day] = { "players": players }

            if (!hasReachedMaxDays && !addedAsAlternate) {
                person.scheduledDays++
            }
        })

        return daysMap
    })

}

function hasNonFoursome(length) {
    return length % 4 == 0
}


function buildSortedObjectFull(day, item, choice) {
    var phoneNumber = "Unknown"
    if (item.phoneNumber != undefined) {
        phoneNumber = item.phoneNumber
    }
    let shortenedName = index.shortenedName(item.name)
    return { "day": day, "name": shortenedName + " (" + choice + ")", "phoneNumber": phoneNumber, "firebaseId": item.firebaseId }
}
function buildSortedObject(pair) {
    var name = pair.name
    return { "name": name, "phoneNumber": pair.phoneNumber, "firebaseId": pair.firebaseId }
}