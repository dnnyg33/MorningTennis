const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp()
// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
exports.sortWeek = functions.database.ref("/incoming/{day}").onWrite((snapshot, context) =>
{
    const original = snapshot.after.val()
    var key = context.params.day
        
    var groups = tennisSort(original)
    return admin.database().ref("/sorted").child(key).set(groups)
});

exports.sortWeekv2 = functions.database.ref("/incoming-v2/{day}").onWrite((snapshot, context) =>
{
    const original = snapshot.after.val()
    var key = context.params.day
        
    var groups = tennisSort(original)
    return admin.database().ref("/sorted-v2").child(key).set(groups)
});

exports.scheduleOpenNotification = functions.pubsub.schedule('00 8 * * FRI')
.timeZone('America/Denver')
.onRun((context) => {
    //todo read db
    const registrationTokens = ["e_hniT70Ql-rzt7iUN73kE:APA91bHlfC-s3_RiXrE8iOVOgYSBXMFlT5_5qQ3422_iusXWZUgfnM-1gWrNdOxd9PUXJuyAnncbPJL6yUa6Vwaf8WsiINBNIeTtD8f7pnnOZHHcxnZx9qT-Tf0H79qpYi5HrwCJLC0C"]
    const message = {
        "notification": {
            "title": "Schedule now open",
            "body": "You can now sign up for next week's schedule in the app."
        },
        "tokens": registrationTokens,
      };
    sendNotificationsToGroup(message, registrationTokens)
});

function sendNotificationsToGroup(message, registrationTokens, res) {
    admin.messaging().sendMulticast(message)
        .then((response) => {
          if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                console.log(resp)
              if (!resp.success) {
                failedTokens.push(registrationTokens[idx]);
              }
            });
            console.log('List of tokens that caused failures: ' + failedTokens);
            res.end('List of tokens that caused failures: ' + failedTokens)
          } else {
              console.log("No errors sending messages")
              res.end("No errors sending messages")
          }
        })
}

function tennisSort(data) {
    let uniqueData = removeDuplicates(data)
    let sorted1 = []
    let sorted2 = []
    let sorted3 = []
    let sorted4 = []
    let sorted5 = []
    
    var playerCount = 0

    for (const [key, item] of Object.entries(uniqueData)) {
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

    sortedList.forEach( playerPreference => {
        let person = uniqueData.find(x => x.phoneNumber == playerPreference.phoneNumber)
        let hasReachedMaxDays = person.maxDays == person.scheduledDays
        if (hasReachedMaxDays) {
            console.log("skipping " + person.name + " who is already scheduled for " + person.scheduledDays + " days")
            return
        }

        let addedAsAlternate = false
        if (playerPreference.day == "Monday") {
            monday.push(buildSortedObject(playerPreference))
            addedAsAlternate = monday.length > 4
        } else if (playerPreference.day == "Tuesday") {
            tuesday.push(buildSortedObject(playerPreference))
            addedAsAlternate = tuesday.length > 4
        }else if (playerPreference.day == "Wednesday") {
            wednesday.push(buildSortedObject(playerPreference))
            addedAsAlternate = wednesday.length > 4
        } else if (playerPreference.day == "Thursday") {
            thursday.push(buildSortedObject(playerPreference))
            addedAsAlternate = thursday.length > 4
        } else if (playerPreference.day == "Friday") {
            friday.push(buildSortedObject(playerPreference))
            addedAsAlternate = friday.length > 4
        } else {
            //skip
        }
        if (!hasReachedMaxDays && !addedAsAlternate) {
            person.scheduledDays++
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

function removeDuplicates(data) {
    var phoneNumbers = []
    var uniquePlayers = []
    //iterate through data 
    for (const [key, item] of Object.entries(data)) {
        let cleanNumber = item.phoneNumber.toString().replace(/\D/g,'')
        if (phoneNumbers.includes(cleanNumber)) {
            console.log("phone numbers includes: " + cleanNumber)
            uniquePlayers = uniquePlayers.filter(f => cleanNumber !== f.phoneNumber.toString().replace(/\D/g,''))

        console.log("uniquePlayers" + JSON.stringify(uniquePlayers))
        }
        item.scheduledDays = 0
            phoneNumbers.push(cleanNumber)
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
    if (item.sunPro === "Yes") {
        hasSunpro = true
    }
    return {"day": day, "name": item.name + " ("+ choice+")", "phoneNumber": phoneNumber, "hasSunpro": hasSunpro}
}
function buildSortedObject(pair) {
    var name = pair.name
    if (pair.hasSunpro) {
        name = "*" + pair.name
    }
    return {"name": name, "phoneNumber": pair.phoneNumber}
}