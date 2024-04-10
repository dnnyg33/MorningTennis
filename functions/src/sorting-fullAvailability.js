const admin = require("firebase-admin");
module.exports.runSort = runSort;
const index = require('./index.js')

async function runSort(original, groupId, weekName) {
    let groups = await tennisSort(original, groupId)
    console.log("groups: " + JSON.stringify(groups))
    admin.database().ref("sorted-v6").child(groupId).child("fullAvailability").child(weekName).set(groups)
    return groups;
}

async function tennisSort(data, groupId) {
    console.log("tennisSort-fullAvailability")
    console.log(JSON.stringify(data))
    let uniqueData = index.removeDuplicates(data)

    let daysMap = { "Monday": 0, "Tuesday": 0, "Thursday": 0, "Friday": 0, "Saturday": 0, "Sunday": 0 }

    //make a map for each day with key as name of day
    return await admin.database().ref("groups-v2").child(groupId).child("meetups2").get().then((snapshot) => {
        if (snapshot.exists()) {
            daysMap = {}
            let meetups = snapshot.val()
            meetups.forEach(meetup => {
                let key = index.capitalizeFirstLetter(meetup.dayOfWeek) + " " + meetup.time
                daysMap[key] = 0
            })
        } else {
            console.log("No data available")
        }
    }).then(() => {
        console.log("Days Map: " + JSON.stringify(daysMap))
        //for each entry, add player to day in order
        let sortedListsMap = {}
        for (const [key, item] of Object.entries(uniqueData)) {
            if (item.choices == undefined) {
                console.log(`Skipping ${item.firebaseId} because they have no choices`)
                continue
            }
            for (let index = 0; index < item.choices.length; index++) {
                const day = item.choices[index];
                const list = sortedListsMap[day] ?? []
                const object = buildSortedObject(item)

                list.push(object)

                sortedListsMap[day] = list
            }
        }
        for (const [key, list] of Object.entries(sortedListsMap)) {
            sortedListsMap[key] = { "players": list }
        }

        console.log("sortedListMap: " + JSON.stringify(sortedListsMap))
        return sortedListsMap;
    })

}

function buildSortedObject(pair) {
    let shortenedName = index.shortenedName(pair.name)
    return { "name": shortenedName, "phoneNumber": pair.phoneNumber, "firebaseId": pair.firebaseId }
}