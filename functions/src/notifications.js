module.exports.run_markNotComingNotification = run_markNotComingNotification;
module.exports.run_scheduledToPlayReminderForAllGroups = run_scheduledToPlayReminderForAllGroups;
module.exports.run_procastinatorNotification = run_procastinatorNotification;
module.exports.run_signupStatusNotification = run_signupStatusNotification;
module.exports.sendNotificationsToGroup = sendNotificationsToGroup;
module.exports.getRegistrationTokensFromFirebaseIds = getRegistrationTokensFromFirebaseIds;

const admin = require("firebase-admin");
const index = require("./index.js")

async function run_markNotComingNotification(data, res) {
    console.log("run_rsvpNotification:data " + JSON.stringify(data))
    if (data.position == null || data.position === "") {
        res.status(400).send("Please provide position")
        return;
    }
    if (data.weekPath == null || data.weekPath === "") {
        res.status(400).send("Please provide weekPath")
        return;
    }
    if (data.dayName == null || data.dayName === "") {
        res.status(400).send("Please provide dayName")
        return;
    }

    const position = parseInt(data.position)
    const weekPath = data.weekPath
    const dayName = data.dayName
    const today = new Date()
    const offsetHours = data.offsetHours ? data.offsetHours : -6
    const dayNumber = index.dayOfWeekAsInteger(dayName)
    //if rsvp is in the past, just break
    if (dayNumber < new Date().getDay()) {
        return;
    }
    //if change is last minute, notify everyone
    if ((dayNumber - today.getDay() == 1 && today.getHours() + offsetHours >= 19) || dayNumber - today.getDay() == 0) {

        return await admin.database().ref(weekPath).once('value', async (snapshot) => {
            const weekData = snapshot.val()
            console.log("weekData: " + JSON.stringify(weekData))
            const dayData = weekData[dayName].players
            var firebaseIds = []
            for (const [userKey, userValue] of Object.entries(dayData)) {
                firebaseIds.push(userValue.firebaseId)
            }
            console.log(firebaseIds)
            await getRegistrationTokensFromFirebaseIds(firebaseIds).then(registrationTokens => {
                const message = {
                    "notification": {
                        "title": "Last minute change!",
                        "body": "Someone has made a last minute change to their RSVP. Please review the schedule for tomorrow (" + dayName + ")."
                    },
                    "tokens": registrationTokens,
                };
                console.log(message.notification.body)
                sendNotificationsToGroup(message, registrationTokens)
            })
            return firebaseIds
        })
    } else {
        await admin.database().ref(weekPath).once('value', async (snapshot) => {
            const weekData = snapshot.val()
            const dayData = weekData[dayName].players
            var slots = 4;
            if (weekData.slots != null) {
                slots = weekData.slots[dayName]
            }
            var firebaseIds = []
            var index = 0
            var playersCount = 0
            for (const [userKey, userValue] of Object.entries(dayData)) {
                if (userValue.isComing !== false) {
                    if (playersCount == slots) {
                        break;
                    }
                    playersCount++
                }
                index++
                if (index <= position) continue;
                if (userValue.isComing == null) {
                    firebaseIds.push(userValue.firebaseId)

                }

            }
            await getRegistrationTokensFromFirebaseIds(firebaseIds).then(registrationTokens => {
                const message = {
                    "notification": {
                        "title": "You've been promoted to play (" + dayName + ")!",
                        "body": "Someone can't make it and you are now scheduled to play on " + dayName + ". Tap to RSVP now."
                    },
                    "tokens": registrationTokens,
                };
                sendNotificationsToGroup(message, registrationTokens)
            })
            console.log("firebaseIds: " + firebaseIds)
            return firebaseIds
        })
    }
}


function run_signupStatusNotification(res, title, body) {
    getRegistrationTokensFromFirebaseIds().then(registrationTokens => {
        const message = {
            "notification": {
                "title": title,
                "body": body
            },
            "tokens": registrationTokens,
        };
        sendNotificationsToGroup(message, registrationTokens)
    });
}



/**If recipients is null, sends to all users in approvedNumbers */
async function getRegistrationTokensFromFirebaseIds(firebaseIds) {
    console.log("preparing to send push to " + (firebaseIds ?? "all users"))
    return await admin.database().ref("approvedNumbers").once('value', (snapshot) => { })
        .then((snapshot) => {
            const data = snapshot.val()
            // console.log(data)
            //flatten users to list of tokens
            var tokenList = []
            //for each user
            for (const [userKey, userValue] of Object.entries(data)) {
                if (firebaseIds === undefined || firebaseIds.includes(userKey)) {
                    //add each token
                    if (userValue.tokens != null) {
                        for (const [tokenKey, tokenValue] of Object.entries(userValue.tokens)) {
                            tokenList.push(tokenValue)
                        }
                    }
                }
            }
            return tokenList;
        })

}

async function sendNotificationsToGroup(message, registrationTokens) {
    let dryRun = process.env.FUNCTIONS_EMULATOR == "true"
    console.log("Sending message (dryRun="+dryRun+"):")
    console.log("tokens:")
    console.log(registrationTokens)
    console.log("message:")
    console.log(message)
    await admin.messaging().sendEachForMulticast(message = message, dryRun = dryRun)
        .then((response) => {
            if (response.failureCount > 0) {
                const failedTokens = [];
                response.responses.forEach((resp, idx) => {

                    if (!resp.success) {
                        failedTokens.push(registrationTokens[idx]);
                    }
                });
                console.log('List of tokens that caused failures('+failedTokens.length+'): ' + failedTokens.join('\r\n'));
            } else {
                console.log("No errors sending messages")
            }
        })
}

/**"You are scheduled to play with {groupName}." */
async function run_scheduledToPlayReminderForAllGroups() {
    const today = new Date()
    let tomorrow = new Date()
    tomorrow.setDate(today.getDate() + 1)
    console.log(tomorrow)
    const dayName = tomorrow.toLocaleString('en-us', { weekday: 'long', timeZone: 'America/Denver' })
    console.log("dayName is " + dayName)
    await admin.database().ref('groups-v2').once('value', async (snapshot) => {
        const data = snapshot.val();
        for (const [key, groupValue] of Object.entries(data)) {
            const groupName = groupValue.name
            let playersRef;
                playersRef = "sorted-v6/" + key + "/" + groupValue.sortingAlgorithm + "/" + getDBRefOfCurrentWeekName() + "/" + dayName + "/players"

            console.log("\nBuilding notifications for " + playersRef)
            await buildNotificationsForDay(playersRef, key, groupName);
        }
    })

    async function buildNotificationsForDay(playersRef, key, groupName) {
        await admin.database().ref(playersRef).once('value', async (snapshot) => {
            const data = snapshot.val();
            if (data == null) {
                console.log("No players for " + groupName + " on this day");
                return;
            }
            var firebaseIds = [];
            var count = 0;
            var limit = 4;
            for (const [userKey, userValue] of Object.entries(data)) {
                console.log("isComing for " + userValue.name + ": " + userValue.isComing);
                if (count == limit) break;
                if (userValue.isComing != null) continue;
                count++;
                firebaseIds.push(userValue.firebaseId);
            }
            console.log("firebaseIds: " + firebaseIds);
            if (firebaseIds.length == 0) {
                console.log("No blank RSVPs for group " + key);
            } else {
                console.log(firebaseIds.length + " blank RSVPs");
                await getRegistrationTokensFromFirebaseIds(firebaseIds).then(async (registrationTokens) => {
                    const message = {
                        "notification": {
                            "title": "Player reminder",
                            "body": "You are scheduled to play tomorrow with " + groupName + ". Tap to RSVP now."
                        },
                        "tokens": registrationTokens,
                    };
                    await sendNotificationsToGroup(message, registrationTokens);
                });
            }
        });
    }
}
/**"You have not signed up to play with {groupName}"*/
async function run_procastinatorNotification() {
    const dayName = new Date().toLocaleString('en-us', { weekday: 'long' })
    console.log(getDBRefOfCurrentWeekName())
    await admin.database().ref('groups-v2').once('value', async (snapshot) => {
        const groupsData = snapshot.val();
        for (const [groupId, groupValue] of Object.entries(groupsData)) {
            const ref_groupWeekSubmissions = "incoming-v4/" + groupId + "/" + getDBRefOfCurrentWeekName()
            console.log(ref_groupWeekSubmissions)
            await admin.database().ref(ref_groupWeekSubmissions).once('value', (snapshot) => { })
                .then(async (snapshot) => {
                    const groupWeekSubmissions = snapshot.val()
                    if (groupWeekSubmissions == null) return;
                    var registeredFirebaseIds = []
                    for (const [key, submission] of Object.entries(groupWeekSubmissions)) {
                        registeredFirebaseIds.push(submission.firebaseId)
                    }

                    await admin.database().ref("approvedNumbers").once('value', async (snapshot2) => {

                        const userData = snapshot2.val()
                        //flatten users to list of firebaseIds
                        var allUsersInGroup = []
                        for (const [userKey, userValue] of Object.entries(userData)) {
                            if (userValue.groups != null && userValue.groups.includes(groupId)) {
                                allUsersInGroup.push({ "firebaseId": userKey, "name": userValue.name })
                            }
                        }

                        var procrastinators = allUsersInGroup.filter((user) => !registeredFirebaseIds.includes(user.firebaseId));
                        console.log("procrastinators in group " + groupId)
                        console.log(procrastinators)
                        var firebaseIdsOnly = procrastinators.map((user) => user.firebaseId)
                        await getRegistrationTokensFromFirebaseIds(firebaseIdsOnly).then(registrationTokens => {
                            const message = {
                                "notification": {
                                    "title": "Sign up for next week",
                                    "body": "You have not yet signed up for next week for " + groupValue.name + ". The schedule closes at 8pm Sunday."
                                },
                                "tokens": registrationTokens,
                            };
                            sendNotificationsToGroup(message, registrationTokens)
                        });

                    })


                })
        }
    })
}

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
