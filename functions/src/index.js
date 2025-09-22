// ===========================
// Firebase Functions v2 setup
// ===========================
const { onRequest } = require("firebase-functions/v2/https");
const { onValueWritten } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const chalk = require("chalk");

// ----- Your modules -----
const sortingTimePreference = require("./sorting-timePreference.js");
const sortingBalanceSkill = require("./sorting-balanceSkill.js");
const sortingFullAvailability = require("./sorting-fullAvailability.js");
const sortingWhenIsGood = require("./sorting-whenisgood.js");
const notifications = require("./notifications.js");
const crud = require("./crud.js");
const utr = require("./utr_updates.js");
const dbScripts = require("./databaseScripts.js");

// If you define helpers like createNewWeekDbPath here, keep them.
// Otherwise ensure you import them from wherever they live.
// Example placeholder (remove if you already import/define it):
// const { createNewWeekDbPath } = require("./helpers.js");

admin.initializeApp();

// ===========================
// Express App + CORS (v2 HTTPS)
// ===========================
const express = require("express");
const cors = require("cors");

const app = express();

const allowedOrigins = new Set([
    "https://morning-tennis.web.app",
    "https://morning-tennis.firebaseapp.com",
    "http://localhost:5050",
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
app.use((req, res, next) => {
  const start = Date.now();
  functions.logger.info(chalk.green("Incoming request"), {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
  });
  next();
  res.on("finish", () => {
    functions.logger.info(chalk.green("HTTP request finished"), {
      method: req.method,
      url: req.originalUrl,      // includes /v1/... route
      status: res.statusCode,
      duration_ms: Date.now() - start,
      ip: req.ip,
    });
  });
});

// Make caches respect per-origin responses
app.use((req, res, next) => {
    res.setHeader("Vary", "Origin");
    next();
});

// JSON body parsing for all routes
app.use(express.json());

// Versioned routers
const v1 = express.Router();
const v2 = express.Router();

// ---------------------------
// Simple health checks
// ---------------------------
v1.get("/health", (_req, res) => res.json({ ok: true, version: "v1" }));
v2.get("/health", (_req, res) => res.json({ ok: true, version: "v2" }));

// ---------------------------
// API routes (formerly https.onRequest)
// ---------------------------

// POST /v1/testSort
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

// POST /v1/requestUTRUpdate
v1.post("/requestUTRUpdate", async (req, res) => {
    try {
        const groupId = req.query["groupId"];
        await utr.executeUTRUpdate(groupId);
        res.status(200).send( { result: "success", message: "UTR update requested" } );
    } catch (e) {
        console.error("requestUTRUpdate error", e);
        res.status(500).json({ error: String(e?.message || e) });
    }
});

// POST /v1/logout
v1.post("/logout", async (req, res) => {
    try {
        console.log("logout function called");
        let body = req.body ?? {};
        if (!body.firebaseId) return res.status(400).send("firebaseId is required");
        if (!body.deviceName) return res.status(400).send("deviceName is required");

        await admin
            .database()
            .ref("approvedNumbers")
            .child(body.firebaseId)
            .child("tokens")
            .child(body.deviceName)
            .remove();

        res.status(200).send({ result: "success", message: "logout successful" } );
    } catch (error) {
        console.log("error:", error);
        res.status(400).send({ result: "error", message: String(error) });
    }
});

// POST /v1/sendRSVPUpdateNotification
v1.post("/sendRSVPUpdateNotification", async (req, res) => {
    console.log("run_rsvpNotification:body", JSON.stringify(req.body));
    const firebaseIds = await notifications.run_markNotComingNotification(req.body.data, res);
    if (firebaseIds != null) {
        res
            .status(200)
            .send({  result: "success", message: "notification sent to " + JSON.stringify(firebaseIds) } );
    } else {
        res.status(200).send({ result: "success", message: "no firebaseIds found" });
    }
});

// POST /v1/db/addPlayersToResults
v1.post("/db/addPlayersToResults", async (req, res) => {
    await dbScripts.addPlayersToResults(req, res);
});

// CRUD routes
v1.post("/createUser", (req, res) => crud.createUser(req, res));
v1.post("/joinGroupRequest", (req, res) => crud.joinGroupRequest(req, res));
v1.post("/createAdmin", (req, res) => crud.toggleAdmin(req, res));
v1.post("/approveJoinRequest", (req, res) => crud.approveJoinRequest(req, res));
v1.post("/approveSetRequest", (req, res) => crud.approveSetRequest(req, res));
v1.post("/modifyGroupMember", (req, res) => crud.modifyGroupMember(req, res));
v1.post("/deleteAccount", (req, res) => crud.deleteAccount(req, res));
v1.post("/deleteGroup", (req, res) => crud.deleteGroup(req, res));
v1.post("/createGroup", (req, res) => crud.createGroup(req, res));
v1.post("/inviteUserToGroup", (req, res) => crud.inviteUserToGroup(req, res));

// Mount versions
app.use("/v1", v1);
app.use("/v2", v2);

// Export ONE HTTP function (v2)
exports.api = onRequest(app);

// ===========================
// Realtime Database Triggers (v2)
// ===========================

// NOTE: Some of your utility functions (like crud.processLateSubmission) expect the
// old "snapshot" shape (with .before / .after). We adapt v2's event.data into a
// compatible object to avoid changing those utilities.
function toCompatSnapshot(event) {
    return { before: event.data.before, after: event.data.after };
}

// /groups-v2/{groupId}/sortingAlgorithm onWrite
exports.sortWeekAfterAlgoChange = onValueWritten(
    { ref: "/groups-v2/{groupId}/sortingAlgorithm" },
    async (event) => {
        const before = event.data.before.val();
        const after = event.data.after.val();

        if (after === null) {
            console.log("group deleted, skipping.");
            return null;
        }
        if (before === after) {
            console.log("sortingAlgorithm unchanged, skipping.");
            return null;
        }

        const groupId = event.params.groupId;
        console.log(`sortingAlgorithm for group ${groupId} changed from ${before} to ${after}`);

        const weekName = utilities.createNewWeekDbPath("Monday");
        const incomingSubmissionsData = (
            await admin.database().ref("incoming-v4").child(groupId).child(weekName).get()
        ).val();

        await runSort(groupId, incomingSubmissionsData, weekName);
    },
);

// /incoming-v4/{groupId}/{day} onWrite
exports.sortWeekv6 = onValueWritten(
    { ref: "/incoming-v4/{groupId}/{day}" },
    async (event) => {
        const groupId = event.params.groupId;
        const weekName = event.params.day;
        const incomingSubmissionsData = event.data.after.val();
        await runSort(groupId, incomingSubmissionsData, weekName);
    },
);

// late-submissions onWrite
exports.lateSubmissions = onValueWritten(
    { ref: "late-submissions/{groupId}/{weekName}/{day}/{pushKey}" },
    async (event) => {
        const { groupId, weekName, day } = event.params;
        const writeLocationV3 = `sorted-v6/${groupId}/timePreference/${weekName}/${day}/players`;
        const writeLocationV4 = `sorted-v6/${groupId}/balanceSkill/${weekName}/${day}/players`;
        const snapshot = toCompatSnapshot(event);
        await crud.processLateSubmission(snapshot, writeLocationV3);
        await crud.processLateSubmission(snapshot, writeLocationV4);
    },
);

// sets-v2 onWrite
exports.onSetReported = onValueWritten(
    { ref: "sets-v2/{groupId}/{pushKey}" },
    async (event) => {
        const groupId = event.params.groupId;
        const setData = event.data.after.val();

        const nonReviewed = setData && setData.verification == null && setData.contestation == null;
        if (nonReviewed) {
            console.log("New unreviewed set reported");
            const players = setData.winners.concat(setData.losers);
            const tokens = await notifications.getRegistrationTokensFromFirebaseIds(players);
            await notifications.sendNotificationsToGroup(
                {
                    notification: {
                        title: "New set reported",
                        body: "A new set has been reported. Please verify the results.",
                    },
                    tokens,
                },
                tokens,
            );
        } else {
            console.log("Set already reviewed");
        }
    },
);

// ===========================
// Scheduler (cron) Triggers (v2)
// ===========================
exports.scheduleUpdateUTR = onSchedule(
    { schedule: "5 12 * * *", timeZone: "America/Denver" },
    async () => {
        await utr.executeUTRUpdate();
    },
);

exports.scheduleReminderNotification = onSchedule(
    { schedule: "0 12 * * *", timeZone: "America/Denver" },
    async () => {
        await notifications.run_scheduledToPlayReminderForAllGroups();
    },
);

exports.scheduleReminderNotificationSunday = onSchedule(
    { schedule: "30 20 * * SUN", timeZone: "America/Denver" },
    async () => {
        await notifications.run_scheduledToPlayReminderForAllGroups();
    },
);

exports.scheduleClosingNotification = onSchedule(
    { schedule: "00 19 * * SUN", timeZone: "America/Denver" },
    async () => {
        notifications.run_signupStatusNotification(
            null,
            "Schedule closing",
            "The schedule for this week is about to close. Please submit or make any changes before 8pm.",
        );
    },
);

exports.scheduleProcrastinatorNotification = onSchedule(
    { schedule: "00 11 * * SUN,SAT", timeZone: "America/Denver" },
    async () => {
        notifications.run_procastinatorNotification();
    },
);

exports.scheduleCloseScheduleCommand = onSchedule(
    { schedule: "05 20 * * SUN", timeZone: "America/Denver" },
    async () => {
        await run_closeSignup();
    },
);

exports.scheduleOpenNotification = onSchedule(
    { schedule: "00 8 * * FRI", timeZone: "America/Denver" },
    async () => {
        await run_openScheduleCommand();
    },
);

// ===========================
// Helpers (unchanged logic)
// ===========================
async function runSort(groupId, incomingSubmissionsData, weekName) {
    admin.database().ref("groups-v2").child(groupId).child("scheduleIsBuilding").set(true);

    await admin
        .database()
        .ref("groups-v2")
        .child(groupId)
        .once("value", (snapshot) => {
            const groupData = snapshot.val();
            if (!groupData?.scheduleIsOpen) {
                console.log("schedule is closed for group: " + groupId);
                admin.database().ref("groups-v2").child(groupId).child("scheduleIsBuilding").set(false);
                return;
            }

            const algorithm = groupData.sortingAlgorithm;
            console.log("running " + algorithm + " algorithm for group: " + groupId);

            if (groupId === "provo" || groupId === "test") {
                sortingBalanceSkill.runSort(incomingSubmissionsData, groupId, weekName);
                sortingTimePreference.runSort(incomingSubmissionsData, groupId, weekName);
                sortingFullAvailability.runSort(incomingSubmissionsData, groupId, weekName);
                sortingWhenIsGood.runSort(incomingSubmissionsData, groupId, weekName);
            } else {
                if (algorithm === "balanceSkill") {
                    sortingBalanceSkill.runSort(incomingSubmissionsData, groupId, weekName);
                } else if (algorithm === "timePreference") {
                    sortingTimePreference.runSort(incomingSubmissionsData, groupId, weekName);
                } else if (algorithm === "fullAvailability") {
                    sortingFullAvailability.runSort(incomingSubmissionsData, groupId, weekName);
                } else if (algorithm === "whenIsGood") {
                    sortingWhenIsGood.runSort(incomingSubmissionsData, groupId, weekName);
                } else {
                    console.log("No algorithm found for group " + groupId);
                }
            }

            admin.database().ref("groups-v2").child(groupId).child("scheduleIsBuilding").set(false);
        });
}

async function run_closeSignup() {
    await admin.database().ref("groups-v2").once("value", async (snapshot) => {
        const groupsData = snapshot.val();
        for (const [groupName, groupData] of Object.entries(groupsData)) {
            console.log("closing schedule for " + groupName + ": " + groupData.name);
            admin.database().ref("groups-v2").child(groupName).child("scheduleIsOpen").set(false);
            if (groupData.sortingAlgorithm === "balanceSkill") {
                await cleanupSortedData(groupsData, groupData);
            }
        }
        notifications.run_signupStatusNotification(
            null,
            "Schedule now closed",
            "View and RSVP for next week's schedule in the app.",
        );
    });
}

async function cleanupSortedData(groupsData, groupData) {
    const path = utilities.createNewWeekDbPath(groupsData.weekStartDay ?? "Monday");
    await admin
        .database()
        .ref("sorted-v6")
        .child(groupData.id)
        .child("balanceSkill")
        .child(path)
        .once("value", (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                console.log("no data found for balanceSkill" + groupData.id + " " + path);
                return;
            }
            for (const [day, dayData] of Object.entries(data)) {
                if (!dayData?.players) continue;
                dayData.players.forEach((player) => {
                    player.name = player.name.replace("(", "").replace(")", "");
                });
                admin
                    .database()
                    .ref("sorted-v6")
                    .child(groupData.id)
                    .child("balanceSkill")
                    .child(path)
                    .child(day)
                    .child("players")
                    .set(dayData.players);
            }
        });
}

function run_openScheduleCommand() {
    admin.database().ref("groups-v2").once("value", (snapshot) => {
        const groupsData = snapshot.val();
        createNewEmptyWeek(groupsData);
        notifications.run_signupStatusNotification(
            null,
            "Schedule now open",
            "You can now sign up for next week's schedule in the app.",
        );
    });

    function createNewEmptyWeek(groupsData) {
        for (const [groupId, groupData] of Object.entries(groupsData)) {
            admin.database().ref("groups-v2").child(groupId).child("scheduleIsOpen").set(true);
            const weekStartDay = groupData.weekStartDay ?? "Monday";
            const path = utilities.createNewWeekDbPath(weekStartDay);
            console.log("Creating empty week for " + groupData.name + " at " + path);
            admin.database().ref("incoming-v4").child(groupId).child(path).child("1").set({
                firebaseId: "weekStart",
            });
        }
    }

}