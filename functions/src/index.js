const functions = require("firebase-functions");
const admin = require("firebase-admin");

// your modules
const sortingTimePreference = require("./sorting-timePreference.js");
const sortingBalanceSkill = require("./sorting-balanceSkill.js");
const sortingFullAvailability = require("./sorting-fullAvailability.js");
const sortingWhenIsGood = require("./sorting-whenisgood.js");
const notifications = require("./notifications.js");
const crud = require("./crud.js");
const utr = require("./utr_updates.js");
const dbScripts = require("./databaseScripts.js");

admin.initializeApp();

/** ---------------------------
 *  Single Express app + CORS
 * --------------------------- */
const express = require("express");
const cors = require("cors");

const app = express();

// CORS allowed origins (add/change as needed)
const allowedOrigins = new Set([
    "https://morning-tennis.web.app",
    "https://morning-tennis.firebaseapp.com",
    "http://localhost:5050",   // your local web dev port (change if needed)
    "http://127.0.0.1:5050",
]);

app.use(
    cors({
        origin: (origin, cb) => {
            // allow tools/no-origin (curl, Postman) and allowed browser origins
            if (!origin || allowedOrigins.has(origin)) return cb(null, true);
            return cb(new Error("Not allowed by CORS"));
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: false, // set true only if sharing cookies across origins
        maxAge: 86400,
    }),
);

// Make caches respect per-origin responses
app.use((req, res, next) => {
    res.setHeader("Vary", "Origin");
    next();
});

// JSON body parsing for all routes
app.use(express.json());
// v1 routes
const v1 = express.Router();
const v2 = express.Router();


// Simple health
v1.get("/health", (_req, res) => res.json({ ok: true, version: "v1" }));
v2.get("/health", (_req, res) => res.json({ ok: true, version: "v2" }));

// Previously: exports.testSort
v1.post("/testSort", async (req, res) => {
    try {
        const groupId = req.query["groupId"];
        const weekName = req.query["weekName"];
        const incomingSubmissionsData =
            req.body?.[weekName] ??
            (await admin.database().ref("incoming-v4").child(groupId).child(weekName).get()).val();

        const result = await sortingBalanceSkill.runSort(incomingSubmissionsData, groupId, weekName);
        const result2 = sortingTimePreference.runSort(incomingSubmissionsData, groupId, weekName);
        const result3 = sortingFullAvailability.runSort(incomingSubmissionsData, groupId, weekName);

        res.json({ balanceSkill: result, timePreference: result2, fullAvailability: result3 });
    } catch (e) {
        console.error("testSort error", e);
        res.status(500).json({ error: String(e?.message || e) });
    }
});

// Previously: exports.requestUTRUpdate
v1.post("/requestUTRUpdate", async (req, res) => {
    try {
        const groupId = req.query["groupId"];
        await utr.executeUTRUpdate(groupId);
        res.status(200).send({ data: { result: "success", message: "UTR update requested" } });
    } catch (e) {
        console.error("requestUTRUpdate error", e);
        res.status(500).json({ error: String(e?.message || e) });
    }
});

// Previously: exports.logout
v1.post("/logout", async (req, res) => {
    try {
        console.log("logout function called");
        let body = req.body?.data ?? {};
        if (!body.firebaseId) return res.status(400).send("firebaseId is required");
        if (!body.deviceName) return res.status(400).send("deviceName is required");

        await admin.database()
            .ref("approvedNumbers")
            .child(body.firebaseId)
            .child("tokens")
            .child(body.deviceName)
            .remove();

        res.status(200).send({ data: { result: "success", message: "logout successful" } });
    } catch (error) {
        console.log("error:", error);
        res.status(400).send({ data: { result: "error", message: String(error) } });
    }
});

// Previously: exports.sendRSVPUpdateNotification
v1.post("/sendRSVPUpdateNotification", async (req, res) => {
    console.log("run_rsvpNotification:body", JSON.stringify(req.body));
    const firebaseIds = await notifications.run_markNotComingNotification(req.body.data, res);
    if (firebaseIds != null) {
        res
            .status(200)
            .send({ data: { result: "success", message: "notification sent to " + JSON.stringify(firebaseIds) } });
    } else {
        res.status(200).send({ data: { result: "success", message: "no firebaseIds found" } });
    }
});

// Previously: exports.addPlayersToResults
v1.post("/db/addPlayersToResults", async (req, res) => {
    await dbScripts.addPlayersToResults(req, res);
});

/** ---- CRUD routes (were individual https.onRequest functions) ---- */
v1.post("/createUser", (req, res) => crud.createUser(req, res));
v1.post("/joinGroupRequest", (req, res) => {
    console.log("Join group request");
    crud.joinGroupRequest(req, res);
});
v1.post("/toggleAdmin", (req, res) => crud.toggleAdmin(req, res));
v1.post("/approveJoinRequest", (req, res) => {
    console.log("Approve join request");
    crud.approveJoinRequest(req, res);
});
v1.post("/approveSetRequest", (req, res) => {
    console.log("Approve set request");
    crud.approveSetRequest(req, res);
});
v1.post("/modifyGroupMember", (req, res) => crud.modifyGroupMember(req, res));
v1.post("/deleteAccount", (req, res) => crud.deleteAccount(req, res));
v1.post("/deleteGroup", (req, res) => crud.deleteGroup(req, res));
v1.post("/createGroup", (req, res) => crud.createGroup(req, res));
v1.post("/inviteUserToGroup", (req, res) => crud.inviteUserToGroup(req, res));


// mount versions
app.use("/v1", v1);
app.use("/v2", v2);

/** Export ONE HTTP function */
exports.api = functions.https.onRequest(app);

/** ---------------------------
 *  Triggers (unchanged)
 * --------------------------- */

exports.sortWeekAfterAlgoChange = functions.database
    .ref("/groups-v2/{groupId}/sortingAlgorithm")
    .onWrite(async (snapshot, context) => {
        const before = snapshot.before.val();
        const after = snapshot.after.val();

        // 1. Ignore if the node was deleted
        if (after === null) {
            console.log("sortingAlgorithm deleted, skipping.");
            return null;
        }

        // 2. Ignore if the value didn’t actually change
        if (before === after) {
            console.log("sortingAlgorithm unchanged, skipping.");
            return null;
        }
        console.log(
            `sortingAlgorithm for group ${context.params.groupId} changed from ${before} to ${after}`
        );
        const groupId = context.params.groupId;

        const weekName = createNewWeekDbPath("Monday");
        const incomingSubmissionsData = (
            await admin.database().ref("incoming-v4").child(groupId).child(weekName).get()
        ).val();
        await runSort(groupId, incomingSubmissionsData, weekName);
    });

exports.sortWeekv6 = functions.database
    .ref("/incoming-v4/{groupId}/{day}")
    .onWrite(async (snapshot, context) => {
        const groupId = context.params.groupId;
        const weekName = context.params.day;
        const incomingSubmissionsData = snapshot.after.val();
        await runSort(groupId, incomingSubmissionsData, weekName);
    });

exports.lateSubmissions = functions.database
    .ref("late-submissions/{groupId}/{weekName}/{day}/{pushKey}")
    .onWrite((snapshot, context) => {
        const groupId = context.params.groupId;
        const weekName = context.params.weekName;
        const day = context.params.day;
        const writeLocationV3 = `sorted-v6/${groupId}/timePreference/${weekName}/${day}/players`;
        const writeLocationV4 = `sorted-v6/${groupId}/balanceSkill/${weekName}/${day}/players`;
        return crud.processLateSubmission(snapshot, writeLocationV3).then(() =>
            crud.processLateSubmission(snapshot, writeLocationV4),
        );
    });

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



//schedules updateUTR function to run at when schedule opens
exports.scheduleUpdateUTR = functions.pubsub.schedule('5 12 * * *')
    .timeZone('America/Denver')
    .onRun(async (context) => {
        await utr.executeUTRUpdate();
    });

exports.scheduleReminderNotification = functions.pubsub
    .schedule("0 12 * * *")
    .timeZone("America/Denver")
    .onRun(async (_context) => {
        await notifications.run_scheduledToPlayReminderForAllGroups();
    });

exports.scheduleReminderNotificationSunday = functions.pubsub
    .schedule("30 20 * * SUN")
    .timeZone("America/Denver")
    .onRun(async (_context) => {
        await notifications.run_scheduledToPlayReminderForAllGroups();
    });

exports.scheduleClosingNotification = functions.pubsub
    .schedule("00 19 * * SUN")
    .timeZone("America/Denver")
    .onRun((_context) => {
        notifications.run_signupStatusNotification(
            null,
            "Schedule closing",
            "The schedule for this week is about to close. Please submit or make any changes before 8pm.",
        );
    });

exports.scheduleCloseScheduleCommand = functions.pubsub
    .schedule("05 20 * * SUN")
    .timeZone("America/Denver")
    .onRun((_context) => {
        run_closeSignup();
    });

exports.scheduleOpenNotification = functions.pubsub
    .schedule("00 8 * * FRI")
    .timeZone("America/Denver")
    .onRun((_context) => {
        run_openScheduleCommand();
    });

/** ---------------------------
 *  (rest of your helpers unchanged)
 * --------------------------- */
// ... keep runSort, run_closeSignup, run_openScheduleCommand, helpers ...

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
}

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
exports.deleteGroup = functions.https.onCall(async (req) => {
    crud.deleteGroup(req)
})
exports.inviteUserToGroup = functions.https.onRequest((req, res) => {
    crud.inviteUserToGroup(req, res)
})
exports.addPlayersToResults = functions.https.onRequest(async (req, res) => {
    await dbScripts.addPlayersToResults(req, res)
})
exports.migrateAdminIdsToFirebaseIds = functions.https.onRequest(async (req, res) => {
    await dbScripts.migrateAdminIdsToFirebaseIds(req, res)
})