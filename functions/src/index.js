const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp()
// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
exports.sortWeek = functions.database.ref("/incoming/{day}").onWrite((snapshot, context) => {
    return runSort(snapshot, "/sorted", context.params.day);
});

exports.sortWeekv2 = functions.database.ref("/incoming-v2/{day}").onWrite((snapshot, context) => {
    return runSort(snapshot, "/sorted-v2", context.params.day);
});

exports.testSendNotification = functions.https.onRequest((req, res) => {
    run_scheduleNotification(res, "Test", "body")
})

exports.testReminder = functions.https.onRequest((req, res) => {
    run_procastinatorNotification(res)

})

//A notification for an alternate who has been promoted to player due to an RSVP event.
exports.sendRSVPUpdateNotification = functions.https.onCall((req, res) => {

    const position = parseInt(req.position)
    const weekPath = req.weekPath
    const dayName = req.dayName
    const today = Date.now().day
    const dayNumber = dayOfWeekAsInteger(dayName)
    //if rsvp is in the past, just break
    if (dayNumber < today) {
        return;
    }
    admin.database().ref(weekPath).once('value', (snapshot) => {
        const weekData = snapshot.val()
        const dayData = weekData[dayName]
        var slots = 4;
        if (weekData.slots != null) {
            slots = weekData.slots[dayName]
        }
        var phoneNumbers = []
        var index = 0
        var playersCount = 0
        for (const [userKey, userValue] of Object.entries(dayData)) {
            if (userValue.isComing !== false) {
                if (playersCount == slots) {
                    break;
                }
                playersCount++
            }
            index++
            if (index <= position) continue;
            if (userValue.isComing == null) {
                let cleanNumber = userValue.phoneNumber.toString().replace(/\D/g, '')
                phoneNumbers.push(cleanNumber.toString())

            }

        }
        console.log(phoneNumbers)

        getNotificationGroup(phoneNumbers).then(registrationTokens => {
            const message = {
                "notification": {
                    "title": "You've been promoted to play (" + dayName + ")!",
                    "body": "Someone can't make it and you are now scheduled to play on " + dayName + ". Tap to RSVP now."
                },
                "tokens": registrationTokens,
            };
            sendNotificationsToGroup(message, registrationTokens, res)
        })
    })

})

exports.scheduleReminderNotification = functions.pubsub.schedule('20 18 * * MON-THU')
    .timeZone('America/Denver')
    .onRun((context) => {
        run_reminderNotification(null)
    })


exports.scheduleReminderNotificationSunday = functions.pubsub.schedule('30 20 * * SUN')
    .timeZone('America/Denver')
    .onRun((context) => {
        run_reminderNotification(null)
    })

exports.scheduleClosingNotification = functions.pubsub.schedule('00 19 * * SUN')
    .timeZone('America/Denver')
    .onRun((context) => {
        run_scheduleNotification(null, "Schedule closing", "The schedule for this week is about to close. Please submit or make any changes before 8pm.")

    });

exports.scheduleProcrastinatorNotification = functions.pubsub.schedule('00 11 * * SUN,SAT')
    .timeZone('America/Denver')
    .onRun((context) => {
        run_procastinatorNotification()
    })

function run_procastinatorNotification() {
    const dayName = new Date().toLocaleString('en-us', { weekday: 'long' })
    const allRegisteredPlayers = "incoming-v2/" + getDBRefOfCurrentWeekName()

    admin.database().ref(allRegisteredPlayers).once('value', (snapshot) => { })
        .then((registered) => {
            const data = registered.val()
            var registeredNumbers = []
            for (const [key, submission] of Object.entries(data)) {
                registeredNumbers.push(submission.phoneNumber)
            }

            admin.database().ref("approvedNumbers").once('value', (snapshot2) => {

                const data2 = snapshot2.val()
                //flatten users to list of phone numbers
                var allPhoneNumbers = []
                for (const [userKey, userValue] of Object.entries(data2)) {
                    allPhoneNumbers.push(userKey)
                }
                console.log("all")


                var procrastinators = allPhoneNumbers.filter((el) => !registeredNumbers.includes(el));
                console.log("procrastinators")
                console.log(procrastinators)
                getNotificationGroup(procrastinators).then(registrationTokens => {
                    const message = {
                        "notification": {
                            "title": "Sign up for next week",
                            "body": "You have not yet signed up for next week. The schedule closes at 8pm Sunday."
                        },
                        "tokens": registrationTokens,
                    };
                    sendNotificationsToGroup(message, registrationTokens, null)
                });

            })


        })

}


exports.scheduleOpenNotification = functions.pubsub.schedule('00 8 * * FRI')
    .timeZone('America/Denver')
    .onRun((context) => {
        run_scheduleNotification(null, "Schedule now open", "You can now sign up for next week's schedule in the app.")
    });

exports.migrateSheetsEntry = functions.database.ref("/incoming/{day}/{entry}").onCreate((snapshot, context) => {
    const data = snapshot.val()
    console.log(JSON.stringify(data))
    //get timestamp
    const originalTimestamp = data.timestamp
    console.log(originalTimestamp)
    //convert timestamp
    const newTimestamp = new Date(originalTimestamp).getTime()
    console.log(newTimestamp)
    //add (not replace) in incoming-v2/{day}/{timestamp}
    const ref = "/incoming-v2/" + context.params.day + "/" + newTimestamp
    console.log(ref)
    return admin.database().ref(ref).update(data)
})

function runSort(snapshot, location, key) {
    const original = snapshot.after.val()

    var groups = tennisSort(original)
    return admin.database().ref(location).child(key).update(groups)
}

function run_scheduleNotification(res, title, body) {
    getNotificationGroup().then(registrationTokens => {
        const message = {
            "notification": {
                "title": title,
                "body": body
            },
            "tokens": registrationTokens,
        };
        sendNotificationsToGroup(message, registrationTokens, res)
    });
}

function run_reminderNotification(res) {
    const dayName = new Date().toLocaleString('en-us', { weekday: 'long' })
    const playersRef = "sorted-v2/" + getDBRefOfCurrentWeekName() + "/" + dayName
    const slotsRef = "sorted-v2/" + getDBRefOfCurrentWeekName() + "/slots"
    admin.database().ref(slotsRef).once('value', (snapshot) => {
        var limit = 4
        if (snapshot.val() != null) {
            limit = snapshot.val()[dayName]
        }
        admin.database().ref(playersRef).once('value', (snapshot) => {
            const data = snapshot.val()
            var phoneNumbers = []
            var count = 0

            for (const [userKey, userValue] of Object.entries(data)) {
                if (count == limit) break;
                if (userValue.isComing === false) continue;
                count++
                let cleanNumber = userValue.phoneNumber.toString().replace(/\D/g, '')
                phoneNumbers.push(cleanNumber.toString())
            }
            console.log(phoneNumbers)

            getNotificationGroup(phoneNumbers).then(registrationTokens => {
                const message = {
                    "notification": {
                        "title": "Player reminder",
                        "body": "You are scheduled to play tomorrow. Tap to RSVP now."
                    },
                    "tokens": registrationTokens,
                };
                sendNotificationsToGroup(message, registrationTokens, res)
            })
        })
    });
}

function getNotificationGroup(recipients) {
    return admin.database().ref("approvedNumbers").once('value', (snapshot) => { })
        .then((snapshot) => {
            const data = snapshot.val()
            // console.log(data)
            //flatten users to list of tokens
            var tokenList = []
            //for each user
            for (const [userKey, userValue] of Object.entries(data)) {
                if (recipients === undefined || recipients.includes(userKey)) {
                    //add each token
                    if (userValue.tokens != null) {
                        for (const [tokenKey, tokenValue] of Object.entries(userValue.tokens)) {
                            tokenList.push(tokenValue)
                        }
                    }
                }
            }
            return tokenList;
        })

}

function sendNotificationsToGroup(message, registrationTokens, res) {
    admin.messaging().sendMulticast(message)
        .then((response) => {
            if (response.failureCount > 0) {
                const failedTokens = [];
                response.responses.forEach((resp, idx) => {

                    if (!resp.success) {
                        failedTokens.push(registrationTokens[idx]);
                    }
                });
                console.log('List of tokens that caused failures: ' + failedTokens);
                if (res != null) {
                    res.end('List of tokens that caused failures: ' + failedTokens)
                }
            } else {
                console.log("No errors sending messages")
                if (res != null) {
                    res.end("No errors sending messages")
                }
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
        playerCount++
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

    sortedList.forEach(playerPreference => {
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
        } else if (playerPreference.day == "Wednesday") {
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
        let cleanNumber = item.phoneNumber.toString().replace(/\D/g, '')
        if (phoneNumbers.includes(cleanNumber)) {
            console.log("phone numbers includes: " + cleanNumber)
            uniquePlayers = uniquePlayers.filter(f => cleanNumber !== f.phoneNumber.toString().replace(/\D/g, ''))

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
    return { "day": day, "name": item.name + " (" + choice + ")", "phoneNumber": phoneNumber, "hasSunpro": hasSunpro }
}
function buildSortedObject(pair) {
    var name = pair.name
    if (pair.hasSunpro) {
        name = "*" + pair.name
    }
    return { "name": name, "phoneNumber": pair.phoneNumber }
}

function getDBRefOfCurrentWeekName() {
    const today = new Date();
    var dayName = "Monday";

    var diff = 0;
    if (today.getDay() == 0) {
        diff = 1 //sunday
    } else {
        diff = -1 * (today.getDay() - 1)
    }
    const monday = today.addDays(diff)
    const weekName = "Monday-" + (monday.getMonth() + 1) + "-" + monday.getDate() + "-" + monday.getFullYear()
    return weekName

}

Date.prototype.addDays = function (d) { return new Date(this.valueOf() + 864E5 * d); };
/**
*
* @method dayOfWeekAsInteger
* @param {String} day
* @return {Number} Returns day as number
*/
function dayOfWeekAsInteger(day) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(day);
}