import * as functions from "firebase-functions";

import { EventContext } from "firebase-functions/lib/cloud-functions";
import { DataSnapshot } from "firebase-functions/lib/providers/database";

// const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp()
// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
exports.sortWeek2 = functions.database.ref("/incoming/{day}").onWrite((snapshot: DataSnapshot, context: EventContext) =>
{
    const original = snapshot.val()
    console.log("original: " + JSON.stringify(original))
    var key = context.params.day
    // var key = Object.keys(original)[0]
    console.log("Key: " + key)
    // console.log("original["+key+"]: " + JSON.stringify(original[key]))

    // if (snapshot.after._path === '/incoming') {
        
    var groups = tennisSort(original)
    console.log("groups: " + JSON.stringify(groups))
    return admin.database().ref("/sorted").child(key).set(groups)
    // } else {
    //     return null
    // }
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
        sorted1.push({"day": item.firstChoice, "name": item.name + " (1)" });
        sorted2.unshift({"day": item.secondChoice, "name": item.name + " (2)"})
        sorted3.push({"day": item.thirdChoice, "name": item.name + " (3)"})
        sorted4.unshift({"day": item.fourthChoice, "name": item.name + " (4)"})
        sorted5.push({"day": item.fifthChoice, "name": item.name + " (5)"})
    }

    let sortedList = [].concat(sorted1, sorted2, sorted3, sorted4, sorted5)

    let monday = []
    let tuesday = []
    let wednesday = []
    let thursday = []
    let friday = []

    sortedList.forEach( pair => {

        if (pair.day == "Monday") {
            monday.push(pair.name)
        } else if (pair.day == "Tuesday") {
            tuesday.push(pair.name)
        }else if (pair.day == "Wednesday") {
            wednesday.push(pair.name)
        } else if (pair.day == "Thursday") {
            thursday.push(pair.name)
        } else if (pair.day == "Friday") {
            friday.push(pair.name)
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