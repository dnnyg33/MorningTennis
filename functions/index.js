const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp()
// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
exports.sortWeek2 = functions.database.ref("/incoming/{day}").onWrite((snapshot, context) =>
{
    const original = snapshot.after.val()
    console.log("original: " + JSON.stringify(original))
    var key = context.params.day
    console.log("Key: " + key)
        
    var groups = tennisSort(original)
    console.log("groups: " + JSON.stringify(groups))
    return admin.database().ref("/sorted").child(key).set(groups)
});

function tennisSort(data) {
    let sorted1 = []
    let sorted2 = []
    let sorted3 = []
    let sorted4 = []
    let sorted5 = []
    console.log("Data: " + JSON.stringify(data))
    var playerCount = 0
    for (const [key, item] of Object.entries(data)) {
        playerCount ++
        sorted1.push(buildSortedObjectFull(item.firstChoice, item, 1))
        sorted2.unshift(buildSortedObjectFull(item.secondChoice, item, 2))
        sorted3.push(buildSortedObjectFull(item.thirdChoice, item, 3))
        sorted4.unshift(buildSortedObjectFull(item.fourthChoice, item, 4))
        sorted5.push(buildSortedObjectFull(item.fifthChoice, item, 5))
    }

    let sortedList = [].concat(sorted1, sorted2, sorted3, sorted4, sorted5)

    let monday = []
    let tuesday = []
    let wednesday = []
    let thursday = []
    let friday = []

    sortedList.forEach( pair => {

        if (pair.day == "Monday") {
            monday.push(buildSortedObject(pair))
        } else if (pair.day == "Tuesday") {
            tuesday.push(buildSortedObject(pair))
        }else if (pair.day == "Wednesday") {
            wednesday.push(buildSortedObject(pair))
        } else if (pair.day == "Thursday") {
            thursday.push(buildSortedObject(pair))
        } else if (pair.day == "Friday") {
            friday.push(buildSortedObject(pair))
        } else {
            //skip
        }
    })

    return {
        "playerCount": playerCount,
        "Monday": monday,
        "Tuesday": tuesday,
        "Wednesday": wednesday,
        "Thursday": thursday,
        "Friday": friday
    }
}
function buildSortedObjectFull(day, item, choice) {
    var phoneNumber = "Unknown"
    if (item.phoneNumber != undefined) {
        phoneNumber = item.phoneNumber 
    } 
    return {"day": day, "name": item.name + " ("+ choice+")", "phoneNumber": phoneNumber}
}
function buildSortedObject(pair) {
    return {"name": pair.name, "phoneNumber": pair.phoneNumber}
}