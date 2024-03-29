const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sortingTimePreference = require("./sorting-timePreference.js")
const sortingBalanceSkill = require("./sorting-balanceSkill.js")
const notifications = require("./notifications.js")
const crud = require("./crud.js")
module.exports.dayOfWeekAsInteger = dayOfWeekAsInteger;
module.exports.shortenedName = shortenedName;
module.exports.removeDuplicates = removeDuplicates;
module.exports.removeEmptyDays = removeEmptyDays;

admin.initializeApp()

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//

exports.sortWeekv5 = functions.database.ref("/incoming-v4/{groupId}/{day}").onWrite((snapshot, context) => {
    const groupId = context.params.groupId;
    const weekName = context.params.day;
    const incomingSubmissionsData = snapshot.after.val()
    sortingTimePreference.runSort(incomingSubmissionsData, groupId, weekName);
    sortingBalanceSkill.runSort(incomingSubmissionsData, groupId, weekName)
});

exports.testFailure = functions.https.onRequest(async (req, res) => {
    console.log("testFailure")
    res.status(500).send("testFailure")
})
exports.testSuccess = functions.https.onRequest(async (req, res) => {
    console.log("testSuccess")
    res.status(200).send("testSuccess")
})

exports.testSort = functions.https.onRequest(async (req, res) => {
    console.log(req.query)
    const groupId = req.query["groupId"];
    const weekName = req.query["weekName"];
    const incomingSubmissionsData = req.body[weekName] ?? (await admin.database().ref("incoming-v4").child(groupId).child(weekName).get()).val()
    const result = await sortingBalanceSkill.runSort(incomingSubmissionsData, groupId, weekName);
    console.log("result: " + JSON.stringify(result))
    const result2 = sortingTimePreference.runSort(incomingSubmissionsData, groupId, weekName);
    console.log("result2: " + JSON.stringify(result2))
    res.send({"balanceSkill": result, "timePreference": result2})
})

exports.lateSubmissions = functions.database.ref("late-submissions/{groupId}/{weekName}/{day}/{pushKey}").onWrite((snapshot, context) => {
    const groupId = context.params.groupId;
    const weekName = context.params.weekName;
    const day = context.params.day
    const writeLocationV3 = "sorted-v5/" + groupId + "/" + "timePreference/" + weekName + "/" + day + "/players"
    const writeLocationV4 = "sorted-v5/" + groupId + "/" + "balanceSkill/" + weekName + "/" + day + "/players"
    return crud.processLateSubmission(snapshot, writeLocationV3).then(() =>
        crud.processLateSubmission(snapshot, writeLocationV4))
})



exports.testSendNotification = functions.https.onRequest(async (req, res) => {
    notifications.run_procastinatorNotification()
    res.end("Done")
})


//A notification for an alternate who has been promoted to player due to an RSVP event or for a last minute change.
exports.sendRSVPUpdateNotification = functions.https.onRequest((req, res) => {
    console.log("run_rsvpNotification:body " + JSON.stringify(req.body))
    notifications.run_rsvpNotification(req.body.data, res)
})


//notification each day for players
exports.scheduleReminderNotification = functions.pubsub.schedule('20 15 * * MON-THU')
    .timeZone('America/Denver')
    .onRun(async (context) => {
        await notifications.run_reminderNotificationsForAllGroups()
    })

//notification for players on Monday, sent out late Sunday night after schedule closes
exports.scheduleReminderNotificationSunday = functions.pubsub.schedule('30 20 * * SUN')
    .timeZone('America/Denver')
    .onRun(async (context) => {
        await notifications.run_reminderNotificationsForAllGroups()
    })

//reminder that schedule is about to close
exports.scheduleClosingNotification = functions.pubsub.schedule('00 19 * * SUN')
    .timeZone('America/Denver')
    .onRun((context) => {
        notifications.run_scheduleNotification(null, "Schedule closing", "The schedule for this week is about to close. Please submit or make any changes before 8pm.")

    });

//reminder to submit schedule
exports.scheduleProcrastinatorNotification = functions.pubsub.schedule('00 11 * * SUN,SAT')
    .timeZone('America/Denver')
    .onRun((context) => {
        notifications.run_procastinatorNotification()
    })

//actually close schedule
exports.scheduleCloseScheduleCommand = functions.pubsub.schedule('05 20 * * SUN')
    .timeZone('America/Denver')
    .onRun((context) => {
        admin.database().ref("groups-v2").once('value', (snapshot) => {
            const groupsData = snapshot.val();
            for (const [groupName, submission] of Object.entries(groupsData)) {
                admin.database().ref("groups-v2").child(groupName).child("scheduleIsOpen").set(false)
            }
            //TODO when schedule timing is dynamic, this will need to be specific to each group so that users aren't blasted for groups they aren't in
            notifications.run_scheduleNotification(null, "Schedule now closed", "View and RSVP for next week's schedule in the app.")
        });
    })

//actually open schedule
exports.scheduleOpenNotification = functions.pubsub.schedule('00 8 * * FRI')
    .timeZone('America/Denver')
    .onRun((context) => {
        admin.database().ref("groups-v2").once('value', (snapshot) => {
            const groupsData = snapshot.val();
            for (const [groupName, submission] of Object.entries(groupsData)) {
                admin.database().ref("groups-v2").child(groupName).child("scheduleIsOpen").set(true)
            }
            //TODO when schedule timing is dynamic, this will need to be specific to each group so that users aren't blasted for groups they aren't in
            notifications.run_scheduleNotification(null, "Schedule now open", "You can now sign up for next week's schedule in the app.")
        });
    });


    ///CRUD
    module.exports.createUser = functions.https.onRequest((req, res) => {
        crud.createUser(req, res)
    })
    exports.joinGroupRequest = functions.https.onRequest((req, res) => {
        crud.joinGroupRequest(req, res)
    })
    exports.toggleAdmin = functions.https.onRequest((req, res) => {
        crud.toggleAdmin(req, res)
    })
    exports.approveJoinRequest = functions.https.onRequest((req, res) => {
        crud.approveJoinRequest(req, res)
    })
    exports.modifyGroupMember = functions.https.onRequest((req, res) => {
        crud.modifyGroupMember(req, res)
    })
    exports.deleteAccount = functions.https.onRequest((req, res) => {
        crud.deleteAccount(req, res)
    })
    exports.inviteUserToGroup = functions.https.onRequest((req, res) => {
        crud.inviteUserToGroup(req, res)
    })








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

Array.prototype.sortBy = function (callback) {
    return this.sort((a, b) => callback(b) - callback(a))
}

Array.prototype.sum = function () {
    return this.reduce(function (a, b) { return a + b });
};

Array.prototype.avg = function () {
    return this.sum() / this.length;
};

const removeNullUndefined = obj => Object.entries(obj).filter(([_, v]) => v != null).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});


function shortenedName(name) {
    var parts = name.split(" ");
    switch (parts.length) {
      case 1:
        return this;
      case 2:
        return `${parts[0]} ${parts[1].substring(0, 1)}.`;
      case 3:
        return `${parts[0]} ${parts[1].substring(0, 1)} ${parts[2]}`;
    }
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

//todo: this function can be removed once app versions are above 28
function removeEmptyDays(result) {
    //remove days where value is 0
    const v5Result = {}
    for (const [key, value] of Object.entries(result)) {
        if (value != 0) {
            v5Result[key] = value
        }
    }
    return v5Result;
}