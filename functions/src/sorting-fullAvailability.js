const admin = require("firebase-admin");
module.exports.runSort = runSort;
const index = require('./index.js')
const utilities = require("./utilities.js");

async function runSort(original, groupId, weekName) {
    let groups = await tennisSort(original, groupId)
    admin.database().ref("sorted-v6").child(groupId).child("fullAvailability").child(weekName).set(groups)
    return groups;
}

async function tennisSort(data, groupId) {
    console.log("tennisSort-fullAvailability")
    console.log(JSON.stringify(data))
    let uniqueData = utilities.removeDuplicates(data)

    let daysMap = {}

    //make a map for each day with key as name of day
    return await utilities.buildDynamicDaysMap(groupId).then((map) => {
        daysMap = map;
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

        return daysMap;
    })

}


function buildSortedObject(pair) {
    let shortenedName = utilities.shortenedName(pair.name)
    return { "name": shortenedName, "phoneNumber": pair.phoneNumber, "firebaseId": pair.firebaseId }
}