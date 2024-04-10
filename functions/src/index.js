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
    admin.database().ref('groups-v2').child(groupId).child("scheduleIsBuilding").set(true);

    sortingTimePreference.runSort(incomingSubmissionsData, groupId, weekName);
    sortingBalanceSkill.runSort(incomingSubmissionsData, groupId, weekName)

    admin.database().ref('groups-v2').child(groupId).child("scheduleIsBuilding").set(false);
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
    res.send({ "balanceSkill": result, "timePreference": result2 })
})

exports.lateSubmissions = functions.database.ref("late-submissions/{groupId}/{weekName}/{day}/{pushKey}").onWrite((snapshot, context) => {
    const groupId = context.params.groupId;
    const weekName = context.params.weekName;
    const day = context.params.day
    const writeLocationV3 = "sorted-v6/" + groupId + "/" + "timePreference/" + weekName + "/" + day + "/players"
    const writeLocationV4 = "sorted-v6/" + groupId + "/" + "balanceSkill/" + weekName + "/" + day + "/players"
    return crud.processLateSubmission(snapshot, writeLocationV3).then(() =>
        crud.processLateSubmission(snapshot, writeLocationV4))
})

exports.logout = functions.https.onRequest((req, res) => {
    console.log("logout function called")
    console.log("req.body.data: " + JSON.stringify(req.body.data))
    let body = req.body.data
    if(body.firebaseId == null){
        res.status(400).send("firebaseId is required")
        return
    }
    if(body.deviceName == null){
        res.status(400).send("deviceName is required")
        return
    }
    admin.database().ref("approvedNumbers").child(body.firebaseId).child("tokens").child(body.deviceName).remove().then(() => {

        res.status(200).send({"data": {"result": "success", "message": "logout successful"}})
    }).catch((error) => {
        console.log("error: " + error)
        res.status(400).send({"data": {"result": "error", "message": error}})
    })
})



exports.test = functions.https.onRequest(async (req, res) => {
    await notifications.run_markNotComingNotification(req.body.data, res)
    res.end("Done")
})


//A notification for an alternate who has been promoted to player due to an RSVP event or for a last minute change.
exports.sendRSVPUpdateNotification = functions.https.onRequest(async (req, res)=> {
    console.log("run_rsvpNotification:body " + JSON.stringify(req.body))
    let firebaseIds = await notifications.run_markNotComingNotification(req.body.data, res)
    if(firebaseIds != null){
        res.status(200).send({"data": {"result": "success", "message": "notification sent to " + JSON.stringify(firebaseIds)}})
    } else {
        res.status(200).send({"data": {"result": "success", "message": "no firebaseIds found"}})
    }
})


//notification each day for players
exports.scheduleReminderNotification = functions.pubsub.schedule('20 15 * * MON-THU')
    .timeZone('America/Denver')
    .onRun(async (context) => {
        await notifications.run_scheduledToPlayReminderForAllGroups()
    })

//notification for players on Monday, sent out late Sunday night after schedule closes
exports.scheduleReminderNotificationSunday = functions.pubsub.schedule('30 20 * * SUN')
    .timeZone('America/Denver')
    .onRun(async (context) => {
        await notifications.run_scheduledToPlayReminderForAllGroups()
    })

//reminder that schedule is about to close
exports.scheduleClosingNotification = functions.pubsub.schedule('00 19 * * SUN')
    .timeZone('America/Denver')
    .onRun((context) => {
        notifications.run_signupStatusNotification(null, "Schedule closing", "The schedule for this week is about to close. Please submit or make any changes before 8pm.")

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
        run_closeSignup();
    })

//actually open schedule
exports.scheduleOpenNotification = functions.pubsub.schedule('00 8 * * FRI')
    .timeZone('America/Denver')
    .onRun((context) => {
        run_openScheduleCommand();
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


async function run_closeSignup() {
   await admin.database().ref("groups-v2").once('value', async (snapshot) => {
        const groupsData = snapshot.val();
        for (const [groupName, groupData] of Object.entries(groupsData)) {
            admin.database().ref("groups-v2").child(groupName).child("scheduleIsOpen").set(false);
            //clean up parenthesis on players who are scheduled
            let path = createNewWeekDbPath(groupsData.weekStartDay ?? "Monday");
            console.log("path: " + path)
            await admin.database().ref("sorted-v6").child(groupData.id).child("balanceSkill").child(path).once('value', (snapshot) => {
                let data = snapshot.val();
                console.log("data: " + JSON.stringify(data))
                for (const [day, dayData] of Object.entries(data)) {
                    if (dayData.players == null) {
                        continue;
                    }
                    dayData.players.forEach(player => {
                        player.name = player.name.replace("(", "").replace(")", "");
                    });
                    console.log("dayData: " + JSON.stringify(dayData))
                    admin.database().ref("sorted-v6").child(groupData.id).child("balanceSkill").child(path)
                        .child(day).child("players").set(dayData.players);
                }
            });
        }
        //TODO when schedule timing is dynamic, this will need to be specific to each group so that users aren't blasted for groups they aren't in
        notifications.run_signupStatusNotification(null, "Schedule now closed", "View and RSVP for next week's schedule in the app.");
    });
}

function run_openScheduleCommand() {
    admin.database().ref("groups-v2").once('value', (snapshot) => {
        const groupsData = snapshot.val();
        createNewEmptyWeek(groupsData);
        //TODO when schedule timing is dynamic, this will need to be specific to each group so that users aren't blasted for groups they aren't in
        notifications.run_signupStatusNotification(null, "Schedule now open", "You can now sign up for next week's schedule in the app.");
    });

function createNewEmptyWeek(groupsData) {
        for (const [groupId, groupData] of Object.entries(groupsData)) {
            admin.database().ref("groups-v2").child(groupId).child("scheduleIsOpen").set(true);
            let weekStartDay = groupData.weekStartDay ?? "Monday";
            let path = createNewWeekDbPath(weekStartDay);
            console.log("Creating empty week for " + groupData.name + " at " + path)
            admin.database().ref("incoming-v4").child(groupId).child(path).child("1").set({
                "firebaseId": "weekStart",
            });

        }
    }
}







Date.prototype.addDays = function (d) { return new Date(this.valueOf() + 864E5 * d); };
function createNewWeekDbPath(weekStartDay) {
    let startDayInt = dayOfWeekAsInteger(weekStartDay); //5
    let now = new Date();
    // now.setDate(now.getDate()-5)//for testing only
    let diff = ((startDayInt + 7) - now.getDay()) % 7; //5
    let startDate = now.addDays(diff);
    let path = weekStartDay + fmt(startDate, "-M-D-YYYY");
    return path;
}

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
        let cleanNumber = item.firebaseId
        if (firebaseId.includes(cleanNumber)) {
            console.log("duplicate entry for: " + cleanNumber)
            uniquePlayers = uniquePlayers.filter(f => cleanNumber !== f.firebaseId)
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

function fmt(date, format = 'YYYY-MM-DDThh:mm:ss') {
    const pad2 = (n) => n.toString().padStart(2, '0');

    const map = {
        YYYY: date.getFullYear(),
        MM: pad2(date.getMonth() + 1),
        DD: pad2(date.getDate()),
        hh: pad2(date.getHours()),
        mm: pad2(date.getMinutes()),
        ss: pad2(date.getSeconds()),
        M: date.getMonth() +1,
        D: date.getDate(),
    };

    return Object.entries(map).reduce((prev, entry) => prev.replace(...entry), format);
}