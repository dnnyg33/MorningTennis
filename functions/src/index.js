const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sortingTimePreference = require("./sorting-timePreference.js")
const sortingBalanceSkill = require("./sorting-balanceSkill.js")
const sortingFullAvailability = require("./sorting-fullAvailability.js")
const sortingWhenIsGood = require("./sorting-whenisgood.js")
const notifications = require("./notifications.js")
const crud = require("./crud.js")
const utr = require("./utr_updates.js")
const dbScripts = require("./databaseScripts.js")
// const express = require("express");
// const app = express();
module.exports.dayOfWeekAsInteger = dayOfWeekAsInteger;
module.exports.shortenedName = shortenedName;
module.exports.removeDuplicates = removeDuplicates;
module.exports.removeEmptyDays = removeEmptyDays;
module.exports.buildDynamicDaysMap = buildDynamicDaysMap
module.exports.fmt = fmt

admin.initializeApp()
// app.use(express.json());

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//


exports.sortWeekAfterAlgoChange = functions.database.ref("/groups-v2/{groupId}/sortingAlgorithm").onWrite(async (snapshot, context) => {
    const groupId = context.params.groupId;
    
     // Check if the group exists
     const groupSnapshot = await admin.database().ref(`/groups-v2/${groupId}`).get();
     if (!groupSnapshot.exists()) {
         console.log(`Group ${groupId} does not exist. Exiting function.`);
         return null; // Exit early if the group is deleted
     }

    const weekName = createNewWeekDbPath("Monday");
    const incomingSubmissionsData = (await admin.database().ref("incoming-v4").child(groupId).child(weekName).get()).val()
    await runSort(groupId, incomingSubmissionsData, weekName);
})

exports.sortWeekv6 = functions.database.ref("/incoming-v4/{groupId}/{day}").onWrite(async (snapshot, context) => {
    const groupId = context.params.groupId;
    const weekName = context.params.day;
    const incomingSubmissionsData = snapshot.after.val()
    await runSort(groupId, incomingSubmissionsData, weekName);
});

exports.testFailure = functions.https.onRequest(async (req, res) => {
    console.log("testFailure")
    res.status(500).send("testFailure")
})
exports.testSuccess = functions.https.onRequest(async (req, res) => {
    console.log(req)
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
    const result3 = sortingFullAvailability.runSort(incomingSubmissionsData, groupId, weekName);
    res.send({ "balanceSkill": result, "timePreference": result2, "fullAvailability": result3 })
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

exports.onSetReported = functions.database.ref("sets-v2/{groupId}/{pushKey}").onWrite(async (snapshot, context) => {
    
    const groupId = context.params.groupId;
    const setData = snapshot.after.val();
    const nonReviewed = setData.verification == null && setData.contestation == null;
    if (nonReviewed) {
        console.log("New unreviewed set reported")
        const players = setData.winners.concat(setData.losers);
        await notifications.getRegistrationTokensFromFirebaseIds(players).then((tokens) => {
            notifications.sendNotificationsToGroup({
                "notification": {
                    "title": "New set reported",
                    "body": "A new set has been reported. Please verify the results.",
                },
                "tokens": tokens,
                // "data": { "setData": setData },

            }, tokens)
        })
    } else {
        console.log("Set already reviewed")
    }
})


//adhoc function to update UTRs
exports.requestUTRUpdate = functions.https.onRequest(async (req, res) => {
    //get groupId from path
    const groupId = req.query["groupId"];
    await utr.executeUTRUpdate(groupId);
    return res.status(200).send({ "data": { "result": "success", "message": "UTR update requested" } });
})


exports.logout = functions.https.onRequest((req, res) => {
    console.log("logout function called")
    console.log("req.body.data: " + JSON.stringify(req.body.data))
    let body = req.body.data
    if (body.firebaseId == null) {
        res.status(400).send("firebaseId is required")
        return
    }
    if (body.deviceName == null) {
        res.status(400).send("deviceName is required")
        return
    }
    admin.database().ref("approvedNumbers").child(body.firebaseId).child("tokens").child(body.deviceName).remove().then(() => {

        res.status(200).send({ "data": { "result": "success", "message": "logout successful" } })
    }).catch((error) => {
        console.log("error: " + error)
        res.status(400).send({ "data": { "result": "error", "message": error } })
    })
})


//A notification for an alternate who has been promoted to player due to an RSVP event or for a last minute change.
exports.sendRSVPUpdateNotification = functions.https.onRequest(async (req, res) => {
    console.log("run_rsvpNotification:body " + JSON.stringify(req.body))
    let firebaseIds = await notifications.run_markNotComingNotification(req.body.data, res)
    if (firebaseIds != null) {
        res.status(200).send({ "data": { "result": "success", "message": "notification sent to " + JSON.stringify(firebaseIds) } })
    } else {
        res.status(200).send({ "data": { "result": "success", "message": "no firebaseIds found" } })
    }
})

//schedules updateUTR function to run at when schedule opens
exports.scheduleUpdateUTR = functions.pubsub.schedule('5 12 * * *')
    .timeZone('America/Denver')
    .onRun(async (context) => {
        await utr.executeUTRUpdate();
    })

//notification each day for players
exports.scheduleReminderNotification = functions.pubsub.schedule('0 12 * * *')
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
    console.log("Join group request")
    crud.joinGroupRequest(req, res)
})
exports.toggleAdmin = functions.https.onRequest((req, res) => {
    crud.toggleAdmin(req, res)
})
exports.approveJoinRequest = functions.https.onRequest((req, res) => {
    console.log("Approve join request")
    crud.approveJoinRequest(req, res)
})
exports.approveSetRequest = functions.https.onRequest((req, res) => {
    console.log("Approve set request")
    crud.approveSetRequest(req, res)
})
exports.modifyGroupMember = functions.https.onRequest((req, res) => {
    crud.modifyGroupMember(req, res)
})
exports.deleteAccount = functions.https.onRequest((req, res) => {
    crud.deleteAccount(req, res)
})
exports.deleteGroup = functions.https.onRequest((req, res) => {
    crud.deleteGroup(req, res)
})
exports.inviteUserToGroup = functions.https.onRequest((req, res) => {
    crud.inviteUserToGroup(req, res)
})

exports.addPlayersToResults = functions.https.onRequest(async (req, res) => {
    await dbScripts.addPlayersToResults(req, res)
})


async function runSort(groupId, incomingSubmissionsData, weekName) {
    admin.database().ref('groups-v2').child(groupId).child("scheduleIsBuilding").set(true);
    await admin.database().ref('groups-v2').child(groupId).once('value', (snapshot) => {
        const groupData = snapshot.val();
        if (!groupData.scheduleIsOpen) {
            console.log("schedule is closed for group: " + groupId);
            admin.database().ref('groups-v2').child(groupId).child("scheduleIsBuilding").set(false);
            return;
        }
        let algorithm = groupData.sortingAlgorithm;
        console.log("running " + algorithm + " algorithm for group: " + groupId);
        if (groupId == "provo" || groupId == "test") {
            sortingBalanceSkill.runSort(incomingSubmissionsData, groupId, weekName);
            sortingTimePreference.runSort(incomingSubmissionsData, groupId, weekName);
            sortingFullAvailability.runSort(incomingSubmissionsData, groupId, weekName);
            sortingWhenIsGood.runSort(incomingSubmissionsData, groupId, weekName);
        } else {
            if (algorithm == "balanceSkill") {
                sortingBalanceSkill.runSort(incomingSubmissionsData, groupId, weekName);
            } else if (algorithm == "timePreference") {
                sortingTimePreference.runSort(incomingSubmissionsData, groupId, weekName);
            } else if (algorithm == "fullAvailability") {
                sortingFullAvailability.runSort(incomingSubmissionsData, groupId, weekName);
            } else if (algorithm == "whenIsGood") {
                sortingWhenIsGood.runSort(incomingSubmissionsData, groupId, weekName);
            } else {
                console.log("No algorithm found for group " + groupId);
            }
        }
        admin.database().ref('groups-v2').child(groupId).child("scheduleIsBuilding").set(false);
    });
}

async function run_closeSignup() {
    await admin.database().ref("groups-v2").once('value', async (snapshot) => {
        const groupsData = snapshot.val();
        for (const [groupName, groupData] of Object.entries(groupsData)) {
            console.log("closing schedule for " + groupName + ": " + groupData.name)
            admin.database().ref("groups-v2").child(groupName).child("scheduleIsOpen").set(false);
            if (groupData.sortingAlgorithm == "balanceSkill") {
                //clean up parenthesis on players who are scheduled
                await cleanupSortedData(groupsData, groupData);
            }
        }
        //TODO when schedule timing is dynamic, this will need to be specific to each group so that users aren't blasted for groups they aren't in
        notifications.run_signupStatusNotification(null, "Schedule now closed", "View and RSVP for next week's schedule in the app.");
    });

    async function cleanupSortedData(groupsData, groupData) {
        let path = createNewWeekDbPath(groupsData.weekStartDay ?? "Monday");
        await admin.database().ref("sorted-v6").child(groupData.id).child("balanceSkill").child(path).once('value', (snapshot) => {
            let data = snapshot.val();
            if (data == null) {
                console.log("no data found for balanceSkill" + groupData.id + " " + path);
                return;
            }
            console.log("data: " + JSON.stringify(data));
            for (const [day, dayData] of Object.entries(data)) {
                if (dayData.players == null) {
                    continue;
                }
                dayData.players.forEach(player => {
                    player.name = player.name.replace("(", "").replace(")", "");
                });
                console.log("dayData: " + JSON.stringify(dayData));
                admin.database().ref("sorted-v6").child(groupData.id).child("balanceSkill").child(path)
                    .child(day).child("players").set(dayData.players);
            }
        });
    }
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

// function consolidateMeetups(meetupsListMap) {
//     let weekOptions = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
//     weekOptions.forEach(day => {
//         //if there are any meetups for this day, leave them alone.
//         for (const [key, meetupsMap] of Object.entries(meetupsListMap)) {

//         if (key.contains(day) && meetupsMap != 0) {
//             continue
//         } else {
//             //else remove all empty meetups for this day and add new single day to consolidatedMeetups
//             let consolidatedMeetups = {};
//             if (meetupsMap != 0) {
//                 consolidatedMeetups[key] = meetupsMap;
//             }
//         }
//         //else remove all empty meetups for this day and add new single day to consolidatedMeetups
//     let consolidatedMeetups = {};

//         if (meetupsMap != 0) {
//             consolidatedMeetups[key] = meetupsMap;


//         for (const [key, meetups] of Object.entries(meetupsMap)) {
//             consolidatedMeetups = consolidatedMeetups.concat(meetups);
//         }
//     }




function buildDynamicDaysMap(groupId) {
    return admin.database().ref("groups-v2").child(groupId).child("meetups2").get().then((snapshot) => {
        if (snapshot.exists()) {
            daysMap = {};
            let meetups = snapshot.val();
            meetups.forEach(meetup => {
                let key = ""
                if (meetup.time == null) {
                    key = capitalizeFirstLetter(meetup.dayOfWeek);
                } else {
                    key = capitalizeFirstLetter(meetup.dayOfWeek) + " " + meetup.time;
                }
                daysMap[key.trim()] = 0;
            });
        } else {
            console.log("No data available");
            let daysMap = { "Monday": 0, "Tuesday": 0, "Wednesday": 0, "Thursday": 0, "Friday": 0 }
        }
        return daysMap;
    });
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
        M: date.getMonth() + 1,
        D: date.getDate(),
    };

    return Object.entries(map).reduce((prev, entry) => prev.replace(...entry), format);
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}