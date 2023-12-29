
const admin = require("firebase-admin");
module.exports.runSort = runSort;
module.exports.removeDuplicates = removeDuplicates;

function runSort(original, groupId, weekName) {
    var groups = tennisSort(original)
    admin.database().ref("sorted-v3").child(groupId).child(weekName).set(groups)
    admin.database().ref("sorted-v5").child(groupId).child("timePreference").child(weekName).set(groups)
    return groups;
}

function tennisSort(data) {
    console.log("tennisSort")
    console.log(JSON.stringify(data))
    let uniqueData = removeDuplicates(data)

    var playerCount = 0
    let sortedListsMap = {}

    for (const [key, item] of Object.entries(uniqueData)) {
        playerCount++
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

    let daysMap = {}

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

function removeDuplicates(data) {
    var firebaseId = []
    var uniquePlayers = []
    //iterate through data 
    for (const [key, item] of Object.entries(data)) {
        let cleanNumber = item.firebaseId.toString().replace(/\D/g, '')
        if (firebaseId.includes(cleanNumber)) {
            console.log("firebaseIds include: " + cleanNumber)
            uniquePlayers = uniquePlayers.filter(f => cleanNumber !== f.firebaseId.toString().replace(/\D/g, ''))
        }
        item.scheduledDays = 0
        firebaseId.push(cleanNumber)
        uniquePlayers.push(item)


    }
    return uniquePlayers
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
    return { "day": day, "name": item.name + " (" + choice + ")", "phoneNumber": phoneNumber, "hasSunpro": hasSunpro }
}
function buildSortedObject(pair) {
    var name = pair.name
    return { "name": name, "phoneNumber": pair.phoneNumber }
}