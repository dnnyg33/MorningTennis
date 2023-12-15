

function run_rsvpNotification(req, res) {
    console.log("run_rsvpNoticication " + JSON.stringify(req.weekPath))

    const position = parseInt(req.position)
    const weekPath = req.weekPath
    const dayName = req.dayName
    const today = new Date()
    const offsetHours = req.offsetHours ? req.offsetHours : -6
    const dayNumber = dayOfWeekAsInteger(dayName)
    //if rsvp is in the past, just break
    if (dayNumber < new Date().getDay()) {
        return;
    }
    console.log(dayNumber)
    console.log(today.getHours() + offsetHours)
    //if change is last minute, notify everyone
    if ((dayNumber - today.getDay() == 1 && today.getHours() + offsetHours >= 19) || dayNumber - today.getDay() == 0) {

        admin.database().ref(weekPath).once('value', (snapshot) => {
            const weekData = snapshot.val()
            console.log("weekData: " + JSON.stringify(weekData))
            const dayData = weekData[dayName]
            var phoneNumbers = []
            for (const [userKey, userValue] of Object.entries(dayData)) {
                let cleanNumber = userValue.phoneNumber.toString().replace(/\D/g, '')
                phoneNumbers.push(cleanNumber.toString())
            }
            console.log(phoneNumbers)
            getNotificationGroup(phoneNumbers).then(registrationTokens => {
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
        })
    } else {
        admin.database().ref(weekPath).once('value', (snapshot) => {
            const weekData = snapshot.val()
            const dayData = weekData[dayName]
            var slots = 4;
            if (weekData.slots != null) {
                slots = weekData.slots[dayName]
            }
            var phoneNumbers = []
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
                    let cleanNumber = userValue.phoneNumber.toString().replace(/\D/g, '')
                    phoneNumbers.push(cleanNumber.toString())

                }

            }
            console.log(phoneNumbers)

            getNotificationGroup(phoneNumbers).then(registrationTokens => {
                const message = {
                    "notification": {
                        "title": "You've been promoted to play (" + dayName + ")!",
                        "body": "Someone can't make it and you are now scheduled to play on " + dayName + ". Tap to RSVP now."
                    },
                    "tokens": registrationTokens,
                };
                sendNotificationsToGroup(message, registrationTokens)
            })
        })
    }
}


function run_scheduleNotification(res, title, body) {
    getNotificationGroup().then(registrationTokens => {
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
async function getNotificationGroup(recipients) {
    console.log("preparing to send push to " + recipients)
    return admin.database().ref("approvedNumbers").once('value', (snapshot) => { })
        .then((snapshot) => {
            const data = snapshot.val()
            // console.log(data)
            //flatten users to list of tokens
            var tokenList = []
            //for each user
            for (const [userKey, userValue] of Object.entries(data)) {
                if (recipients === undefined || recipients.includes(userKey)) {
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
    await admin.messaging().sendMulticast(message)
        .then((response) => {
            if (response.failureCount > 0) {
                const failedTokens = [];
                response.responses.forEach((resp, idx) => {

                    if (!resp.success) {
                        failedTokens.push(registrationTokens[idx]);
                    }
                });
                console.log('List of tokens that caused failures: ' + failedTokens);
            } else {
                console.log("No errors sending messages")
            }
        })
}


async function run_reminderNotificationsForAllGroups() {
    const today = new Date()
    let tomorrow = new Date()
    tomorrow.setDate(today.getDate() + 1)
    console.log(tomorrow)
    const dayName = tomorrow.toLocaleString('en-us', { weekday: 'long', timeZone: 'America/Denver' })
    console.log("dayName is " + dayName)
    await admin.database().ref('groups').once('value', async (snapshot) => {
        const data = snapshot.val();
        for (const [key, groupValue] of Object.entries(data)) {
            const groupName = groupValue.name
            let playersRef;
            if (groupValue.sortingAlgorithm == "timePreference") {
                playersRef = "sorted-v3/" + key + "/" + getDBRefOfCurrentWeekName() + "/" + dayName
            } else {
                playersRef = "sorted-v4/" + key + "/" + getDBRefOfCurrentWeekName() + "/" + dayName + "/players"
            }

            console.log("\nBuilding notifications for " + playersRef)
            await buildNotificationsForDay(playersRef, key, groupName);
        }
    })

    async function buildNotificationsForDay(playersRef, key, groupName) {
        await admin.database().ref(playersRef).once('value', async (snapshot) => {
            const data = snapshot.val();
            if (data == null) {
                console.log("No players for this group/day");
                return;
            }
            var phoneNumbers = [];
            var count = 0;
            var limit = 4;
            for (const [userKey, userValue] of Object.entries(data)) {
                console.log("isComing for " + userValue.name + ": " + userValue.isComing);
                if (count == limit) break;
                if (userValue.isComing != null) continue;
                count++;
                let cleanNumber = userValue.phoneNumber.toString().replace(/\D/g, '');
                phoneNumbers.push(cleanNumber.toString());
            }
            console.log(phoneNumbers);
            if (phoneNumbers.length == 0) {
                console.log("No blank RSVPs for group " + key);
            } else {
                console.log(phoneNumbers.length + " blank RSVPs");
                await getNotificationGroup(phoneNumbers).then(async (registrationTokens) => {
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
                    var registeredNumbers = []
                    for (const [key, submission] of Object.entries(groupWeekSubmissions)) {
                        registeredNumbers.push(submission.phoneNumber)
                    }

                    await admin.database().ref("approvedNumbers").once('value', async (snapshot2) => {

                        const userData = snapshot2.val()
                        //flatten users to list of phone numbers
                        var allUsersInGroup = []
                        for (const [userKey, userValue] of Object.entries(userData)) {
                            if (userValue.groups != null && userValue.groups.includes(groupId)) {
                                allUsersInGroup.push({ "phoneNumber": userKey, "name": userValue.name })
                            }
                        }

                        var procrastinators = allUsersInGroup.filter((user) => !registeredNumbers.includes(user.phoneNumber));
                        console.log("procrastinators in group " + groupId)
                        console.log(procrastinators)
                        var numbersOnly = procrastinators.map((user) => user.phoneNumber)
                        await getNotificationGroup(numbersOnly).then(registrationTokens => {
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
