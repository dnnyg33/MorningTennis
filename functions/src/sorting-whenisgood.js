const admin = require("firebase-admin");
module.exports.runSort = runSort;
const index = require('./index.js')

async function runSort(original, groupId, weekName) {
    let groups =  tennisSortForIndividual(original, groupId)
    console.log("groups: " + JSON.stringify(groups))
    admin.database().ref("sorted-v6").child(groupId).child("whenIsGood").child(weekName).set(groups)
    return groups;
}

 function tennisSortForIndividual(data, groupId) {
    //for every player, for every slot, create list of other players who are available
    let uniqueData = index.removeDuplicates(data)
    let mapOfGroupsByPlayer = {}
    let listOfAllSlots = flattenSlots(uniqueData)
    for (const [key, player] of Object.entries(uniqueData)) {
        let mapOfMyGroups = {}
        if (player.availableSlots == undefined) {
            console.log(`Skipping ${player.firebaseId} because they have no availableSlots`)
            continue
        }
        for (let index = 0; index < player.availableSlots.length; index++) {
            const slot = player.availableSlots[index];
            const dayOfWeek = slot.dayOfWeek
            const startTime = slot.startTime
            const endTime = slot.endTime
            console.log("slot: " + JSON.stringify(slot))
            //find similar slots in list and add to this player's list
            let grouping = listOfAllSlots.filter(x => x.dayOfWeek == dayOfWeek && parseInt(x.startTime) <= parseInt(endTime) && parseInt(x.endTime) >= parseInt(startTime))
            console.log("grouping: " + JSON.stringify(grouping))
            //add property of overlap time
            grouping = grouping.map(x => { 
                let latestStart = Math.max(x.startTime, startTime)
                let earliestEnd = Math.min(x.endTime, endTime)
                return { "firebaseId": x.firebaseId, "name": x.name, "phoneNumber": x.phoneNumber, "overlap": earliestEnd - latestStart, "startTime": x.startTime, "endTime": x.endTime} })
            mapOfMyGroups[slot.label] = {"players": grouping } //todo display name of slot ex// "Tuesday 8am - 10am"
        }
        mapOfGroupsByPlayer[player.firebaseId] = mapOfMyGroups
    }
    return mapOfGroupsByPlayer

}

function flattenSlots(data) {
    let list = []
    for (const [key, player] of Object.entries(data)) {
        if (player.availableSlots == undefined) {
            console.log(`Skipping ${player.firebaseId} because they have no availableSlots`)
            continue
        }
        for (let i = 0; i < player.availableSlots.length; i++) {
            const slot = player.availableSlots[i];
            const dayOfWeek = slot.dayOfWeek
            const startTime = slot.startTime
            const endTime = slot.endTime
            const shortName = index.shortenedName(player.name)
            slotObj = { "firebaseId": player.firebaseId, "dayOfWeek": dayOfWeek, "startTime": startTime, "endTime": endTime, "phoneNumber": player.phoneNumber, "name": shortName }
            list.push(slotObj)
        }
    }
    return list
}

async function tennisSort(data, groupId) {
    console.log("tennisSort-fullAvailability")
    console.log(JSON.stringify(data))
    let uniqueData = index.removeDuplicates(data)

    let daysMap = {}

    //make a map for each day with key as name of day
    return await index.buildDynamicDaysMap(groupId).then((map) => {
        // daysMap = map;//todo enable this for all slots to show
        console.log("FA Days Map: " + JSON.stringify(daysMap))
        //for each entry, add player to day in order
        for (const [key, item] of Object.entries(uniqueData)) {
            if (item.choices == undefined) {
                console.log(`Skipping ${item.firebaseId} because they have no choices`)
                continue
            }
            for (let index = 0; index < item.choices.length; index++) {
                const day = item.choices[index].trim();
                let list;
                if (daysMap[day] == undefined || daysMap[day] == 0) {
                    list = { "players": [] }
                } else {
                    list = daysMap[day]
                }
                
                const object = buildSortedObject(item)

                list.players.push(object)

                daysMap[day] = list
            }
        }

        console.log("sortedListMap: " + JSON.stringify(daysMap))
        return daysMap;
    })

}


function buildSortedObject(pair) {
    let shortenedName = index.shortenedName(pair.name)
    return { "name": shortenedName, "phoneNumber": pair.phoneNumber, "firebaseId": pair.firebaseId }
}

function diff (num1, num2) {
    if (num1 > num2) {
      return num1 - num2
    } else {
      return num2 - num1
    }
  }