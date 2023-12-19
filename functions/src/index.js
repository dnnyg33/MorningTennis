const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sortingv3 = require("./sorting-v3.js")
const sortingv4 = require("./sorting-v4.js")
const notifications = require("./notifications.js")
const crud = require("./crud.js")

admin.initializeApp()

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//

exports.sortWeekv3 = functions.database.ref("/incoming-v4/{groupId}/{day}").onWrite((snapshot, context) => {
    const groupId = context.params.groupId;
    const weekName = context.params.day;
    const incomingSubmissionsData = snapshot.after.val()
    sortingv3.runSort(incomingSubmissionsData, groupId, weekName);
});


exports.testSort = functions.https.onRequest(async (req, res) => {
    console.log(req.query)
    const groupId = req.query["groupId"];
    const weekName = req.query["weekName"];
    const incomingSubmissionsData = req.body[weekName];
    const result = await sortingv4.runSort(incomingSubmissionsData, groupId, weekName);
    res.send(result)
})

exports.sortWeekv4 = functions.database.ref("/incoming-v4/{groupId}/{day}").onWrite((snapshot, context) => {
    const groupId = context.params.groupId;
    const weekName = context.params.day;
    const incomingSubmissionsData = snapshot.after.val()
    //to switch between testing v3 and v4, just change the file const below
    sortingv4.runSort(incomingSubmissionsData, groupId, weekName)
})

exports.lateSubmissions = functions.database.ref("late-submissions/{groupId}/{weekName}/{day}/{pushKey}").onWrite((snapshot, context) => {
    const groupId = context.params.groupId;
    const weekName = context.params.weekName;
    const day = context.params.day
    const writeLocationV3 = "sorted-v3/" + groupId + "/" + weekName + "/" + day
    const writeLocationV4 = "sorted-v4/" + groupId + "/" + weekName + "/" + day + "/players/"
    return crud.processLateSubmission(snapshot, writeLocationV3).then(() =>
        crud.processLateSubmission(snapshot, writeLocationV4))
})



exports.testSendNotification = functions.https.onRequest(async (req, res) => {
    await notifications.run_rsvpNotification(req, res)
    res.end("Done")
})


//A notification for an alternate who has been promoted to player due to an RSVP event or for a last minute change.
exports.sendRSVPUpdateNotification = functions.https.onCall(async (req, res) => {
    notifications.run_rsvpNotification(req, res)
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
            run_scheduleNotification(null, "Schedule now closed", "View and RSVP for next week's schedule in the app.")
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