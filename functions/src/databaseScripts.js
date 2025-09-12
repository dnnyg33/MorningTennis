const functions = require("firebase-functions");
const admin = require("firebase-admin");
module.exports.addPlayersToResults = addPlayersToResults
// module.exports.migrateAdminIdsToFirebaseIds = migrateAdminIdsToFirebaseIds
const index = require("./index.js")


exports.migrateToSetsV2 = functions.https.onRequest(async (req, res) => {
    const groupId = req.query["groupId"];
    let sets = await admin.database().ref("sets").child(groupId).get()
    let weeks = sets.val()
    for (const [weekName, week] of Object.entries(weeks)) {
        for (const [pushId, set] of Object.entries(week)) {
            set.weekName = weekName
            await admin.database().ref("sets-v2").child(groupId).child(pushId).set(set)
        }
    }
    let setsv2 = (await admin.database().ref("sets-v2").child(groupId).get()).val()
    for (const [pushId, setData] of Object.entries(setsv2)) {
        if (setData.timestamp == null) {
            console.log("no timestamp found for set: " + pushId)
            setData.timestamp = Date.parse(setData.timeSubmitted)
            console.log("added timestamp: " + setData.timestamp)
        }
        if (setData.verification == null) {
            setData.verification = { "isVerified": true, "verifiedBy": "admin", "dateVerified": new Date().getTime() }
        }
        if (setData.winningScore == 8) {
            if (setData.losingScore >= 5) {
                setData.winningScore = 7
            } else {
                setData.winningScore = 6
            }
        }
        await subOutPhoneNumber(setData.winners);
        await subOutPhoneNumber(setData.losers);
        admin.database().ref("sets-v2").child(groupId).child(pushId).set(setData)
    }
    res.send("done")

    async function subOutPhoneNumber(players) {
        for (i = 0; i < players.length; i++) {
            if (players[i].length == 10) {
                //make call to get firebaseId
                await admin.database().ref("approvedNumbers").once('value', async (snapshot) => {
                    //loop results
                    const allUsers = snapshot.val();
                    for (const [key, serverUser] of Object.entries(allUsers)) {
                        if (serverUser.phoneNumber == players[i]) {
                            console.log("substituting firebaseId (" + key + ") for phoneNumber: " + serverUser.phoneNumber);
                            players[i] = key;
                            console.log("substituted player: " + players[i])
                            break;
                        }
                    }
                });
            }
        }
    }
})


exports.populateUtrIfEmpty = functions.https.onRequest(async (req, res) => {
    // await createResultFromSet();
    await admin.database().ref('member_rankings').once('value', async (snapshot) => {
        const groups = snapshot.val();
        for (const [groupId, group] of Object.entries(groups)) {
            console.log("Fixing UTRs for group " + groupId);
            for (const [firebaseId, ranking] of Object.entries(group)) {
                console.log("Ranking " + firebaseId + " " + JSON.stringify(ranking));
                if (ranking.utr == undefined || ranking.utr == null) {
                    continue;
                }
                let newUtr;
                if (ranking.utr == "NaN") {
                    newUtr = 4.0
                } else {
                    newUtr = parseFloat(ranking.utr)
                }
                console.log("newUtr: " + newUtr)

                admin.database().ref('member_rankings').child(groupId).child(firebaseId).child("utr").set(newUtr)
            }
        }
    });
    res.end("Done");
})

async function addPlayersToResults(req, res) {
    // function getHydratedResultsForUser(firebaseId, page, pageSize) {
    var results = []
    await admin.database().ref("results-v2").once('value', async (snapshot) => {
        const data = snapshot.val()
        for (const [key, resultGroupForUser] of Object.entries(data)) {
            for(const [key1, result] of Object.entries(resultGroupForUser)){
                //lookup set
                const set = await admin.database().ref("sets-v2").child(result.group).child(result.setId).once('value')
                const setData = set.val()
                if (setData == null) {
                    console.log("No set found for path " + result.group + "/" + result.setId)
                    continue
                }
                result.winners = setData.winners
                result.losers = setData.losers
                console.log("Adding players to path: " + key + "/" + key1)
                admin.database().ref("results-v2").child(key).child(key1).set(result)
            }
        }
        });
        res.end("Done")
}


//this script will look for adminIds in groups-v2 that are not firebaseIds (length <=10) and convert them to firebaseIds
//it will also delete any groups where the adminId cannot be found in approvedNumbers
exports.migrateAdminIdsToFirebaseIds = functions.https.onRequest(async (req, res) => {
    await admin.database().ref('groups-v2').once('value', async (snapshot) => {
        const groups = snapshot.val();
        for (const [groupId, group] of Object.entries(groups)) {
            console.log("Processing group " + groupId);
            if (group.admins == null) {
                console.log("No admins found for group: " + groupId + ", deleting group");
                await admin.database().ref('groups-v2').child(groupId).remove()
                continue;
            }
            let newAdmins = {}
            for (const [pushId, adminId] of Object.entries(group.admins)) {
                const firebaseId = await index.sanitizeUserIdToFirebaseId(adminId)
                if( firebaseId != null ) {
                    newAdmins[pushId] = firebaseId
                }
            }
            if (newAdmins == null || Object.keys(newAdmins).length == 0) {
                console.log("No valid admins found for group " + groupId + ", deleting group")
                await admin.database().ref('groups-v2').child(groupId).remove()
                continue;
            }
            await admin.database().ref('groups-v2').child(groupId).child("admins").set(newAdmins)
        }
    });
    res.end("Done");

})