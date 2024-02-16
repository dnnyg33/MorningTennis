
const admin = require("firebase-admin");
module.exports.runSort = runSort;
const index = require('./index.js')

function runSort(original, groupId, weekName) {
    var groups = tennisSort(original)
    admin.database().ref("sorted-v3").child(groupId).child(weekName).set(groups)
    admin.database().ref("sorted-v6").child(groupId).child("timePreference").child(weekName).set(groups)
    const v5Result = index.removeEmptyDays(groups)
    admin.database().ref("sorted-v5").child(groupId).child("timePreference").child(weekName).set(v5Result)
    
    return groups;
}

function tennisSort(data) {
    console.log("tennisSort")
    console.log(JSON.stringify(data))
    let uniqueData = index.removeDuplicates(data)

    var playerCount = 0
    let sortedListsMap = {}

    for (const [key, item] of Object.entries(uniqueData)) {
        playerCount++
        if (item.choices == undefined) {
            console.log("Skipping " + item.name + " because they have no choices")
            continue
        }
        for (let index = 0; index < item.choices.length; index++) {
            const choice = item.choices[index];
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

    let daysMap = {"Monday": 0, "Tuesday": 0, "Wednesday": 0, "Thursday": 0, "Friday": 0}

    sortedList.forEach(playerPreference => {
        let person = uniqueData.find(x => x.phoneNumber == playerPreference.phoneNumber)
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

}

function hasNonFoursome(length) {
    return length % 4 == 0
}


function buildSortedObjectFull(day, item, choice) {
    var phoneNumber = "Unknown"
    if (item.phoneNumber != undefined) {
        phoneNumber = item.phoneNumber
    }
    var hasSunpro = false
    console.log("Item.hasSunpro " + item.sunPro)
    if (item.sunPro === "Yes") {//replace with tab tracker
        hasSunpro = true
    }
    let shortenedName = index.shortenedName(item.name)
    return { "day": day, "name": shortenedName + " (" + choice + ")", "phoneNumber": phoneNumber, "hasSunpro": hasSunpro }
}
function buildSortedObject(pair) {
    var name = pair.name
    return { "name": name, "phoneNumber": pair.phoneNumber }
}