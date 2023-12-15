const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sortingv3 = require("./sorting-v3.js")
const sortingv4 = require("./sorting-v4.js")
const notificatios = require("./notifications.js")
const crud = require("./crud.js")

admin.initializeApp()

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//

exports.sortWeekv3 = functions.database.ref("/incoming-v4/{groupId}/{day}").onWrite((snapshot, context) => {
    return runSort(snapshot, "/sorted-v3/" + context.params.groupId, context.params.day);
});

exports.sortWeekv4 = functions.database.ref("/incoming-v4/{groupId}/{day}").onWrite((snapshot, context) => {
    admin.database().ref('groups-v2').child(context.params.groupId).child("scheduleIsBuilding").set(true);

    admin.database().ref('member_rankings').child(context.params.groupId).once('value', async (memberRankingsSnapshot) => {
        const ranking = memberRankingsSnapshot.val();
        const incomingSubmissions = snapshot.after.val()
        const writeLocation = "/sorted-v4/" + context.params.groupId
        const weekNameKey = context.params.day;
        const result = tennisSortBySkill(incomingSubmissions, ranking)
        console.log("writing result " + JSON.stringify(result))
        admin.database().ref('groups-v2').child(context.params.groupId).child("scheduleIsBuilding").set(false);
        return admin.database().ref(writeLocation).child(weekNameKey).set(result)
    })
})

exports.lateSubmissions = functions.database.ref("late-submissions/{groupId}/{weekName}/{day}/{pushKey}").onWrite((snapshot, context) => {
    const groupId = context.params.groupId;
    const weekName = context.params.weekName;
    const day = context.params.day
    const writeLocationV3 = "sorted-v3/" + groupId + "/" + weekName + "/" + day
    const writeLocationV4 = "sorted-v4/" + groupId + "/" + weekName + "/" + day + "/players/"
    return processLateSubmission(snapshot, writeLocationV3).then(() =>
        processLateSubmission(snapshot, writeLocationV4))
})



//A notification for an alternate who has been promoted to player due to an RSVP event or for a last minute change.
exports.sendRSVPUpdateNotification = functions.https.onCall(async (req, res) => {

    run_rsvpNotification(req, res)
})


//notification each day for players
exports.scheduleReminderNotification = functions.pubsub.schedule('20 15 * * MON-THU')
    .timeZone('America/Denver')
    .onRun(async (context) => {
        await run_reminderNotificationsForAllGroups()
    })

//notification for players on Monday, sent out late Sunday night after schedule closes
exports.scheduleReminderNotificationSunday = functions.pubsub.schedule('30 20 * * SUN')
    .timeZone('America/Denver')
    .onRun(async (context) => {
        await run_reminderNotificationsForAllGroups()
    })

//reminder that schedule is about to close
exports.scheduleClosingNotification = functions.pubsub.schedule('00 19 * * SUN')
    .timeZone('America/Denver')
    .onRun((context) => {
        run_scheduleNotification(null, "Schedule closing", "The schedule for this week is about to close. Please submit or make any changes before 8pm.")

    });

//reminder to submit schedule
exports.scheduleProcrastinatorNotification = functions.pubsub.schedule('00 11 * * SUN,SAT')
    .timeZone('America/Denver')
    .onRun((context) => {
        run_procastinatorNotification()
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
            run_scheduleNotification(null, "Schedule now open", "You can now sign up for next week's schedule in the app.")
        });
    });



exports.testSendNotification = functions.https.onRequest(async (req, res) => {
    await run_procastinatorNotification()
    res.end("Done")
})


exports.testSort = functions.https.onRequest((req, res) => {
    console.log(req.query)
    const groupId = req.query["groupId"];
    const weekName = req.query["weekName"];
    console.log(groupId + " " + weekName);
    const result = sortingv4.tennisSortBySkill(req.body[weekName])
    res.send(result)
    // admin.database().ref('member_rankings').child(groupId).once('value', async (snapshot) => {
    // const ranking = snapshot.val();
    // const result = tennisSortBySkill(req.body[weekName], ranking)
    // res.send(result)

    // return admin.database().ref("/sorted-v4/"+groupId).child(weekName).update(result)
    // })
})



function getDBRefOfCurrentWeekName() {
    const today = new Date();
    var dayName = "Monday";

    var diff = 0;
    if (today.getDay() == 0) {
        diff = 1 //sunday
    } else if (today.getDay() == 6) {
        diff = 2 //saturday
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