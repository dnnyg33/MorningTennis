// ===========================
// Firebase Functions v2 (CommonJS)
// ===========================
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
module.exports.addPlayersToResults = addPlayersToResults
module.exports.migrateAdminIdsToFirebaseIds = migrateAdminIdsToFirebaseIds
// module.exports.migrateAdminIdsToFirebaseIds = migrateAdminIdsToFirebaseIds
const utilities = require("./utilities");

// ===========================
// HTTP Endpoints (v2 onRequest)
// ===========================

exports.migrateToSetsV2 = onRequest(async (req, res) => {
    try {
        const groupId = req.query["groupId"];
        if (!groupId) return res.status(400).send("Missing groupId");

        const setsSnap = await admin.database().ref("sets").child(groupId).get();
        const weeks = setsSnap.val() || {};

        // Move sets -> sets-v2, flattening weekName into each set
        for (const [weekName, week] of Object.entries(weeks)) {
            for (const [pushId, set] of Object.entries(week)) {
                set.weekName = weekName;
                await admin.database().ref("sets-v2").child(groupId).child(pushId).set(set);
            }
        }

        // Normalize fields in sets-v2
        const setsV2Snap = await admin.database().ref("sets-v2").child(groupId).get();
        const setsV2 = setsV2Snap.val() || {};

        for (const [pushId, setData] of Object.entries(setsV2)) {
            if (setData.timestamp == null) {
                console.log("no timestamp found for set:", pushId);
                setData.timestamp = Date.parse(setData.timeSubmitted);
                console.log("added timestamp:", setData.timestamp);
            }
            if (setData.verification == null) {
                setData.verification = {
                    isVerified: true,
                    verifiedBy: "admin",
                    dateVerified: Date.now(),
                };
            }
            if (setData.winningScore === 8) {
                if (setData.losingScore >= 5) {
                    setData.winningScore = 7;
                } else {
                    setData.winningScore = 6;
                }
            }

            await subOutPhoneNumber(setData.winners);
            await subOutPhoneNumber(setData.losers);

            await admin.database().ref("sets-v2").child(groupId).child(pushId).set(setData);
        }

        res.send("done");
    } catch (err) {
        console.error("migrateToSetsV2 error:", err);
        res.status(500).send(String(err?.message || err));
    }

    async function subOutPhoneNumber(players) {
        if (!Array.isArray(players)) return;
        // Build map of phoneNumber -> firebaseId once for speed
        const allUsersSnap = await admin.database().ref("approvedNumbers").get();
        const allUsers = allUsersSnap.val() || {};
        const phoneToFirebase = {};
        for (const [firebaseId, serverUser] of Object.entries(allUsers)) {
            const pn = serverUser?.phoneNumber;
            if (pn) phoneToFirebase[pn] = firebaseId;
        }

        for (let i = 0; i < players.length; i++) {
            const maybePhone = players[i];
            if (typeof maybePhone === "string" && maybePhone.length === 10 && phoneToFirebase[maybePhone]) {
                const firebaseId = phoneToFirebase[maybePhone];
                console.log(`substituting firebaseId (${firebaseId}) for phoneNumber: ${maybePhone}`);
                players[i] = firebaseId;
            }
        }
    }
});

exports.populateUtrIfEmpty = onRequest(async (_req, res) => {
    try {
        const groupsSnap = await admin.database().ref("member_rankings").get();
        const groups = groupsSnap.val() || {};

        for (const [groupId, group] of Object.entries(groups)) {
            console.log("Fixing UTRs for group", groupId);
            for (const [firebaseId, ranking] of Object.entries(group)) {
                if (ranking?.utr == null) continue;

                let newUtr;
                if (ranking.utr === "NaN") {
                    newUtr = 4.0;
                } else {
                    newUtr = parseFloat(ranking.utr);
                }

                if (!Number.isFinite(newUtr)) continue;

                await admin
                    .database()
                    .ref("member_rankings")
                    .child(groupId)
                    .child(firebaseId)
                    .child("utr")
                    .set(newUtr);
            }
        }

        res.end("Done");
    } catch (err) {
        console.error("populateUtrIfEmpty error:", err);
        res.status(500).send(String(err?.message || err));
    }
});

// this is still exported for your Express route: v1.post("/db/addPlayersToResults", ...)
async function addPlayersToResults(_req, res) {
    try {
        const resultsSnap = await admin.database().ref("results-v2").get();
        const data = resultsSnap.val() || {};

        for (const [userKey, resultGroupForUser] of Object.entries(data)) {
            for (const [resultKey, result] of Object.entries(resultGroupForUser)) {
                // lookup set
                const setSnap = await admin.database().ref("sets-v2").child(result.group).child(result.setId).get();
                const setData = setSnap.val();
                if (setData == null) {
                    console.log("No set found for path", `${result.group}/${result.setId}`);
                    continue;
                }

                result.winners = setData.winners;
                result.losers = setData.losers;

                console.log("Adding players to path:", `${userKey}/${resultKey}`);
                await admin.database().ref("results-v2").child(userKey).child(resultKey).set(result);
            }
        }

        res.end("Done");
    } catch (err) {
        console.error("addPlayersToResults error:", err);
        res.status(500).send(String(err?.message || err));
    }
}

// this script looks for adminIds in groups-v2 that are not firebaseIds (<=10 chars) and converts them
// it will also delete any groups where the adminId cannot be found in approvedNumbers
async function migrateAdminIdsToFirebaseIds(_req, res) {
    try {
        const groupsSnap = await admin.database().ref("groups-v2").get();
        const groups = groupsSnap.val() || {};

        for (const [groupId, group] of Object.entries(groups)) {
            console.log("Processing group", groupId);

            if (!group?.admins) {
                console.log("No admins found for group:", groupId, "deleting group");
                await admin.database().ref("groups-v2").child(groupId).remove();
                continue;
            }

            const newAdmins = {};
            for (const [pushId, adminId] of Object.entries(group.admins)) {
                const firebaseId = await utilities.sanitizeUserIdToFirebaseId(adminId);
                if (firebaseId) newAdmins[pushId] = firebaseId;
            }

            if (!newAdmins || Object.keys(newAdmins).length === 0) {
                console.log("No valid admins found for group", groupId, "deleting group");
                await admin.database().ref("groups-v2").child(groupId).remove();
                continue;
            }

            await admin.database().ref("groups-v2").child(groupId).child("admins").set(newAdmins);
        }

        res.end("Done");
    } catch (err) {
        console.error("migrateAdminIdsToFirebaseIds error:", err);
        res.status(500).send(String(err?.message || err));
    }
};
