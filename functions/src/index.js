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
const tabs = require("./tabs.js");
const ladder = require("./ladder.js");
const ladderMatches = require("./ladder_matches.js");
const utilities = require("./utilities.js");
const scheduleTiming = require("./scheduleTiming.js");

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

// POST /v1/db/populateMemberCount
v1.post("/db/populateMemberCount", async (req, res) => {
    await dbScripts.populateMemberCount(req, res);
});

// POST /v1/db/deleteEmptyGroups
v1.post("/db/deleteEmptyGroups", async (req, res) => {
    await dbScripts.deleteEmptyGroups(req, res);
});

// POST /v1/db/autoApproveStaleSets
v1.post("/db/autoApproveStaleSets", async (req, res) => {
    await dbScripts.autoApproveStaleSets(utr, req, res);
});

v1.post("/tabReport", async (req, res) => {
    try {
        const { startDate, endDate, groupId, sortingAlgorithm, playerIndexBound } = req.body;
        const report = await tabs.generateTabReport(startDate, endDate, groupId, sortingAlgorithm, playerIndexBound);
        res.status(200).send({ data: { result: "success", report } });
    } catch (e) {
        console.error("tabReport error", e);
        res.status(500).json({ error: String(e?.message || e) });
    }
});

// Ladder routes
v1.post("/ladderStandings", (req, res) => ladder.ladderStandings(req, res));
v1.post("/reportLadderMatch", (req, res) => ladderMatches.reportLadderMatch(req, res));
v1.post("/deleteLadderMatch", (req, res) => ladderMatches.deleteLadderMatch(req, res));
v1.post("/disputeLadderMatch", (req, res) => ladderMatches.disputeLadderMatch(req, res));
v1.post("/withdrawLadderMatch", (req, res) => ladderMatches.withdrawLadderMatch(req, res));

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
v1.post("/removePlayerFromGroup", (req, res) => crud.removePlayerFromGroup(req, res));
v1.post("/logout", (req, res) => crud.logout(req, res));

// expose scheduled and pub/sub functions for running via HTTP
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
v1.post("/run_openScheduleCommand", async (req, res) => {
    try {
        await run_openScheduleCommand();
        res.status(200).send( { result: "success", message: "open schedule command executed" } );
    } catch (e) {
        console.error("run_openScheduleCommand error", e);
        res.status(500).json({ error: String(e?.message || e) });
    }
});
// Runs the per-group timing pass on demand. `at` (ISO 8601) pretends it is
// another moment, for checking a group's configured times without waiting.
v1.post("/run_signupTimingTick", async (req, res) => {
    try {
        const at = req.query["at"] ? new Date(req.query["at"]) : new Date();
        if (isNaN(at.getTime())) {
            res.status(400).json({ error: "at must be a valid date" });
            return;
        }
        await run_signupTimingTick(at);
        res.status(200).send( { result: "success", message: "signup timing tick executed for " + at.toISOString() } );
    } catch (e) {
        console.error("run_signupTimingTick error", e);
        res.status(500).json({ error: String(e?.message || e) });
    }
});
v1.post("/run_closeSignup", async (req, res) => {
    try {
        await run_closeSignup();
        res.status(200).send( { result: "success", message: "close signup command executed" } );
    } catch (e) {
        console.error("run_closeSignup error", e);
        res.status(500).json({ error: String(e?.message || e) });
    }
});

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

exports.scheduleProcrastinatorNotification = onSchedule(
    { schedule: "00 11 * * SUN,SAT", timeZone: "America/Denver" },
    async () => {
        notifications.run_procastinatorNotification();
    },
);

// Opening, the "closing soon" warning and closing all used to be fixed crons
// (Fri 8am / Sun 7pm / Sun 8:05pm). They now run off each group's
// scheduleTimePreferences, so this ticks often enough to honour any time an
// admin picks and does nothing for groups that aren't due.
exports.scheduleSignupTick = onSchedule(
    { schedule: `*/${scheduleTiming.TICK_MINUTES} * * * *`, timeZone: scheduleTiming.DEFAULT_TIMEZONE },
    async () => {
        await run_signupTimingTick();
    },
);

exports.scheduleDeleteEmptyGroups = onSchedule(
    { schedule: "0 3 * * FRI", timeZone: "America/Denver" },
    async () => {
        await dbScripts.runDeleteEmptyGroups();
    },
);

exports.scheduleAutoApproveStaleSets = onSchedule(
    { schedule: "00 8 * * FRI", timeZone: "America/Denver" },
    async () => {
        await dbScripts.runAutoApproveStaleSets(utr);
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

            // if (groupId === "provo" || groupId === "test") {
            //     sortingBalanceSkill.runSort(incomingSubmissionsData, groupId, weekName);
            //     sortingTimePreference.runSort(incomingSubmissionsData, groupId, weekName);
            //     sortingFullAvailability.runSort(incomingSubmissionsData, groupId, weekName);
            //     sortingWhenIsGood.runSort(incomingSubmissionsData, groupId, weekName);
            // } else {
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
            // }

            admin.database().ref("groups-v2").child(groupId).child("scheduleIsBuilding").set(false);
        });
}

/**
 * Runs every group through its own scheduleTimePreferences and applies whatever
 * became due since the last tick. One group failing must not stop the rest.
 */
async function run_signupTimingTick(now = new Date()) {
    const snapshot = await admin.database().ref("groups-v2").once("value");
    const groupsData = snapshot.val() ?? {};
    for (const [groupId, groupData] of Object.entries(groupsData)) {
        try {
            await applyDueSignupEvents(groupId, groupData, groupsData, now);
        } catch (e) {
            console.error("signup timing failed for group " + groupId, e);
        }
    }
}

async function applyDueSignupEvents(groupId, groupData, groupsData, now) {
    const due = scheduleTiming.dueEvents(groupData, now);
    const preferences = due.preferences;

    const actions = [];
    if (due.openAt !== null) {
        actions.push({
            at: due.openAt,
            marker: "lastOpenedAt",
            run: () => openScheduleForGroup(groupId, groupData, now),
        });
    }
    // Groups that never close (players can join late) would be lied to by a
    // warning that signups are about to.
    if (due.closingWarningAt !== null && scheduleTiming.signupsCanClose(groupData)) {
        actions.push({
            at: due.closingWarningAt,
            marker: "lastClosingWarningAt",
            run: () =>
                notifications.run_groupSignupStatusNotification(
                    groupId,
                    "Schedule closing",
                    "Signups for " + groupData.name + " close at " + preferences.signupCloseTime +
                        ". Please submit or make any changes before then.",
                ),
        });
    }
    if (due.closeAt !== null) {
        actions.push({
            at: due.closeAt,
            marker: "lastClosedAt",
            run: () => closeSignupForGroup(groupId, groupData, groupsData, now),
        });
    }
    if (actions.length === 0) return;

    // A single tick can cover more than one moment (a long catch-up window, or
    // a short signup window), so replay them in the order they happened.
    actions.sort((a, b) => a.at - b.at);
    for (const action of actions) {
        await action.run();
        await admin
            .database()
            .ref("groups-v2")
            .child(groupId)
            .child("scheduleAutomation")
            .child(action.marker)
            .set(action.at);
    }
}

async function openScheduleForGroup(groupId, groupData, now = new Date()) {
    const canClose = scheduleTiming.signupsCanClose(groupData);
    // Only a group that closes can meaningfully be "already open" ahead of its
    // reset. A group that never closes is open by construction, so reading the
    // flag would silence its reset announcement every single week.
    const openedEarlyByAdmin = canClose && groupData.scheduleIsOpen === true;
    await admin.database().ref("groups-v2").child(groupId).child("scheduleIsOpen").set(true);

    const preferences = scheduleTiming.preferencesFor(groupData);
    const path = utilities.createNewWeekDbPath(
        weekStartDayFor(groupData, preferences),
        groupReferenceDate(now, preferences),
    );
    console.log("Creating empty week for " + groupData.name + " at " + path);
    await admin.database().ref("incoming-v4").child(groupId).child(path).child("1").set({
        firebaseId: "weekStart",
    });

    if (openedEarlyByAdmin) {
        // An admin opened signups ahead of the scheduled time; don't announce it twice.
        console.log("schedule for " + groupData.name + " was already open, skipping notification");
        return;
    }
    // A group that never closed was never blocked from signing up, so telling
    // it signups are "now open" would be meaningless — what changed is the week.
    await notifications.run_groupSignupStatusNotification(
        groupId,
        canClose ? "Schedule now open" : "New week started",
        canClose
            ? "You can now sign up for next week's schedule with " + groupData.name + "."
            : "A new week has started for " + groupData.name +
                ". Enter the times you can play.",
    );
}

async function closeSignupForGroup(groupId, groupData, groupsData, now = new Date()) {
    if (!scheduleTiming.signupsCanClose(groupData)) {
        // players can join late and it doesn't affect sorting
        console.log("skipping close for whenIsGood group " + groupData.name);
        return;
    }
    console.log("closing schedule for " + groupId + ": " + groupData.name);
    await admin.database().ref("groups-v2").child(groupId).child("scheduleIsOpen").set(false);
    if (groupData.sortingAlgorithm === "balanceSkill") {
        await cleanupSortedData(groupsData, groupData, now);
    }
    await notifications.run_groupSignupStatusNotification(
        groupId,
        "Schedule now closed",
        "View and RSVP for next week's schedule with " + groupData.name + ".",
    );
}

/** The week the app is showing at this moment, in group time — evening opens
 * and closes land on a different UTC day, and midweek opens on a different
 * week, so the reference can't be the container's `new Date()`. */
function groupReferenceDate(now, preferences) {
    return scheduleTiming.weekReferenceDate(now, preferences);
}

/** The day a play week is named after. `playStartDay` is where the app reads
 * this from; `weekStartDay` is the older group-level field, kept as a fallback
 * so groups that only ever had that keep their existing node names. */
function weekStartDayFor(groupData, preferences) {
    return preferences.playStartDay ?? groupData.weekStartDay ?? "Monday";
}

/** Closes every group now, regardless of its configured time. */
async function run_closeSignup(now = new Date()) {
    const snapshot = await admin.database().ref("groups-v2").once("value");
    const groupsData = snapshot.val() ?? {};
    for (const [groupId, groupData] of Object.entries(groupsData)) {
        await closeSignupForGroup(groupId, groupData, groupsData, now);
    }
}

async function cleanupSortedData(groupsData, groupData, now = new Date()) {
    const preferences = scheduleTiming.preferencesFor(groupData);
    const path = utilities.createNewWeekDbPath(
        weekStartDayFor(groupData, preferences),
        groupReferenceDate(now, preferences),
    );
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

/** Opens every group now, regardless of its configured time. */
async function run_openScheduleCommand(now = new Date()) {
    const snapshot = await admin.database().ref("groups-v2").once("value");
    const groupsData = snapshot.val() ?? {};
    for (const [groupId, groupData] of Object.entries(groupsData)) {
        await openScheduleForGroup(groupId, groupData, now);
    }
}