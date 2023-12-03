const functions = require("firebase-functions");
const admin = require("firebase-admin");
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

exports.testSendNotification = functions.https.onRequest((req, res) => {
    admin.database().ref("approvedNumbers").once('value', (snapshot) => {
        //loop results
        const allUsers = snapshot.val();
        console.log(JSON.stringify(allUsers))
        for (const [key, groupValue] of Object.entries(allUsers)) {
            groupValue.phoneNumber = key;
            admin.database().ref("approvedNumbers").child(key).update(groupValue);
        }
        res.end();
    })
})

exports.testReminder = functions.https.onRequest((req, res) => {
    admin.database().ref('groups').child('provo').child('scheduleIsOpen').set(false)

})

exports.testSort = functions.https.onRequest((req, res) => {
    console.log(req.query)
    const groupId = req.query["groupId"];
    const weekName = req.query["weekName"];
    console.log(groupId + " " + weekName);
    const result = tennisSort(req.body[weekName])
    res.send(result)
    // admin.database().ref('member_rankings').child(groupId).once('value', async (snapshot) => {
    // const ranking = snapshot.val();
    // const result = tennisSortBySkill(req.body[weekName], ranking)
    // res.send(result)

    // return admin.database().ref("/sorted-v4/"+groupId).child(weekName).update(result)
    // })
})

exports.createUser = functions.https.onRequest((req, res) => {
    const body = req.body.data;
    console.log(JSON.stringify(body))
    //check for existing user with id as phone number
    //if none, query all objects to see if email is in any user objects
    admin.database().ref("approvedNumbers").once('value', (snapshot) => {
        //loop results
        const allUsers = snapshot.val();
        for (const [key, groupValue] of Object.entries(allUsers)) {
            if ((body.phoneNumber != null && body.phoneNumber == groupValue.phoneNumber) ||
                (body.email != null && body.email == groupValue.email)) {
                groupValue.name = body.name;
                groupValue.email = body.email;
                groupValue.phoneNumber = body.phoneNumber;
                groupValue.tokens = body.tokens;
                groupValue.suspended = body.suspended;
                groupValue.groups = body.groups;
                admin.database().ref("approvedNumbers").child(key).update(groupValue);
                res.status(200).send({ "data": groupValue });
                return;
            }
        }

        const newUser = {
            name: body.name,
            email: body.email,
            phoneNumber: body.phoneNumber
        };
        admin.database().ref("approvedNumbers").child(body.firebaseId).set(newUser);
        res.status(201).send({ "data": newUser });
    })
});

exports.joinGroupRequest = functions.https.onRequest((req, res) => {
    const body = req.body.data;
    admin.database().ref("groups-v2").child(body.groupId).once('value', (snapshot) => {
        const group = snapshot.val();
        if (group == null) {
            res.status(400).send({ "data": { "result": "failure", "reason": "group not found" } })
            return;
        }
        if (group.visibility == "public") {
            //append groupId to user's list of groups
            admin.database().ref("approvedNumbers").child(body.userId).child('groups').once('value', (snapshotGroups) => {
                var groups = snapshotGroups.val()
                if (groups == null) {
                    groups = []
                }
                if (groups.includes(body.groupId)) {
                    res.send({ "data": { "result": "failure", "reason": "already in group" } })
                } else {
                    groups.push(body.groupId)
                    admin.database().ref("approvedNumbers").child(body.userId).child("groups").update(groups)
                    res.send({ "data": { "result": "success" } })
                }
            })
        } else if (group.visibility == "private") {
            const request = {
                "userId": body.userId, "status": "pending", "dateInitiated": new Date().getTime()
            }
            admin.database().ref("joinRequests").child(body.groupId).push(request)
            res.send({ "data": { "result": "pending" } })
        } else if (group.visibility == "unlisted") {
            //TODO How can this happen?
        }
    }).catch((error) => { console.error(error); res.send(500, { "data": { "result": "failure", "reason": error } }); });
})


exports.addUserToGroup = functions.https.onRequest((req, res) => {
    const body = req.body.data;
    console.log("body: " + JSON.stringify(body))
    //check that adder is admin
    admin.database().ref('groups').child(body.groupId).child("admins").once('value', (snapshot) => {
        const adminList = snapshot.val()
        if (!adminList.includes(body.adminId)) {
            console.log(body.adminId + "not found")
            res.sendStatus(401)
        }
        admin.database().ref("approvedNumbers").child(body.userId).once('value', (snapshot) => {
            var user = snapshot.val()
            if (user == null) {
                var newUser = { "name": body.userName, "groups": [body.groupId] }
                admin.database().ref("approvedNumbers").child(body.userId).set(newUser)
                res.send({ "data": { "groupId": body.groupId, "userId": body.userId, "message": "User created and added to group" } })
            } else {
                console.log("Found user: " + JSON.stringify(user))
                if (user.groups == null) {
                    user.groups = [body.groupId];
                    console.log("User updated with group: " + JSON.stringify(user))
                    admin.database().ref("approvedNumbers").child(body.userId).update(user)
                    res.send({ "data": { "groupId": body.groupId, "userId": body.userId, "message": "Existing user added to first group" } })
                }
                if (user.groups.includes(body.groupId)) {
                    res.send({ "data": { "groupId": body.groupId, "userId": body.userId, "message": "User already in group" } })
                } else {
                    user.groups.push(body.groupId)
                    console.log(user.groups)
                    admin.database().ref("approvedNumbers").child(body.userId).update(user)
                    res.send({ "data": { "groupId": body.groupId, "userId": body.userId, "message": "Existing user added to new group" } })
                }
            }

        })
    })
})

exports.deleteAccount = functions.https.onRequest((req, res) => {
    const db = admin.database();
    const body = req.body.data;
    const removedLog = []
    const promises = []
    const usersPromise = admin.database().ref("approvedNumbers").child(body.userId).once('value', (snapshot) => {
        const user = snapshot.val()
        console.log("user: " + JSON.stringify(user))
        if (user != null && user.groups != null) {
            user.groups.forEach(group => {
                console.log("group: " + group)
                //remove as admin
                const adminPromise = db.ref("groups-v2").child(group).child("admins").once('value', (snapshot) => {
                    const adminList = snapshot.val()
                    console.log("adminList: " + JSON.stringify(adminList))
                    for (const [key, value] of Object.entries(adminList)) {
                        console.log("key: " + key + " value: " + value)
                        if (value == body.userId) {
                            delete adminList[key]
                            console.log("adminList: " + JSON.stringify(adminList))
                            removedLog.push("groups-v2." + group + ".admins." + key)
                            db.ref("groups-v2").child(group).child("admins").set(adminList)
                        }
                    }
                })
                promises.push(adminPromise)
                //remove member rankings for groups
                removedLog.push("member_ranking." + group + "." + body.userId)
                db.ref("member_rankings").child(group).child(body.userId).remove()

                //remove join requests
                const joinPromise = db.ref("joinRequests").child(group).once('value', (snapshot) => {
                    const joinRequests = snapshot.val()
                    if (joinRequests == null) return;
                    for (const [key, request] of Object.entries(joinRequests)) {
                        if (request.userId == body.userId) {
                            db.ref("joinRequests").child(key).remove()
                            removedLog.push("joinRequests." + key)
                        }
                    }
                });
                promises.push(joinPromise)
            });
        }
    }).then(() => {
        //remove actual user
        db.ref("approvedNumbers").child(body.userId).remove()
        removedLog.push("approvedNumbers." + body.userId)
    });
    promises.push(usersPromise)


    //remove subscriptions
    const subPromise = db.ref("subscriptions").once('value', (snapshot) => {
        const subscriptions = snapshot.val()
        for (const [key, subscription] of Object.entries(subscriptions)) {
            if (subscription.userId == body.userId) {
                db.ref("subscriptions").child(key).remove()
                removedLog.push("subscription." + key)
            }
        }
    });
    promises.push(subPromise)
    Promise.all(promises).then(() => {
        res.send({ "data": { "result": "success", "log": removedLog } })
    });
});

//A notification for an alternate who has been promoted to player due to an RSVP event or for a last minute change.
exports.sendRSVPUpdateNotification = functions.https.onCall((req, res) => {

    run_rsvpNotification(req, res)

})


//notification each day for players
exports.scheduleReminderNotification = functions.pubsub.schedule('20 15 * * MON-THU')
    .timeZone('America/Denver')
    .onRun((context) => {
        run_reminderNotificationsForAllGroups()
    })

//notification for players on Monday, sent out late Sunday night after schedule closes
exports.scheduleReminderNotificationSunday = functions.pubsub.schedule('30 20 * * SUN')
    .timeZone('America/Denver')
    .onRun((context) => {
        run_reminderNotificationsForAllGroups()
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
        admin.database().ref('groups-v2').child('provo').child('scheduleIsOpen').set(false)
        admin.database().ref('groups').child('provo').child('scheduleIsOpen').set(false)
        admin.database().ref('groups').child('sunpro').child('scheduleIsOpen').set(false)
        admin.database().ref('groups-v2').child('sunpro').child('scheduleIsOpen').set(false)
    })

//actually open schedule
exports.scheduleOpenNotification = functions.pubsub.schedule('00 8 * * FRI')
    .timeZone('America/Denver')
    .onRun((context) => {
        admin.database().ref('groups').child('provo').child('scheduleIsOpen').set(true)
        admin.database().ref('groups-v2').child('provo').child('scheduleIsOpen').set(true)
        admin.database().ref('groups').child('sunpro').child('scheduleIsOpen').set(true)
        admin.database().ref('groups-v2').child('sunpro').child('scheduleIsOpen').set(true)
        run_scheduleNotification(null, "Schedule now open", "You can now sign up for next week's schedule in the app.")
    });


function run_reminderNotificationsForAllGroups() {
    const today = new Date()
    let tomorrow = new Date()
    tomorrow.setDate(today.getDate() + 1)
    console.log(tomorrow)
    const dayName = tomorrow.toLocaleString('en-us', { weekday: 'long', timeZone: 'America/Denver' })
    console.log("dayName is " + dayName)
    admin.database().ref('groups').once('value', async (snapshot) => {
        const data = snapshot.val();
        for (const [key, groupValue] of Object.entries(data)) {
            const groupName = groupValue.name
            const playersRef = "sorted-v3/" + key + "/" + getDBRefOfCurrentWeekName() + "/" + dayName
            console.log("\nBuilding notifications for " + playersRef)

            await admin.database().ref(playersRef).once('value', async (snapshot) => {
                const data = snapshot.val()
                if (data == null) {
                    console.log("No players for this group/day")
                    return;
                }
                var phoneNumbers = []
                var count = 0
                var limit = 4
                for (const [userKey, userValue] of Object.entries(data)) {
                    console.log("isComing for " + userValue.name + ": " + userValue.isComing)
                    if (count == limit) break;
                    if (userValue.isComing != null) continue;
                    count++
                    let cleanNumber = userValue.phoneNumber.toString().replace(/\D/g, '')
                    phoneNumbers.push(cleanNumber.toString())
                }
                console.log(phoneNumbers)
                if (phoneNumbers.length == 0) {
                    console.log("No blank RSVPs for group " + key)
                } else {
                    console.log(phoneNumbers.length + " blank RSVPs")
                    await getNotificationGroup(phoneNumbers).then(registrationTokens => {
                        const message = {
                            "notification": {
                                "title": "Player reminder",
                                "body": "You are scheduled to play tomorrow with " + groupName + ". Tap to RSVP now."
                            },
                            "tokens": registrationTokens,
                        };
                        sendNotificationsToGroup(message, registrationTokens, null)
                    })
                }
            });
        }
    })
}

function run_procastinatorNotification() {
    const dayName = new Date().toLocaleString('en-us', { weekday: 'long' })
    console.log(getDBRefOfCurrentWeekName())
    admin.database().ref('groups').once('value', (snapshot) => {
        const groupsData = snapshot.val();
        for (const [groupName, submission] of Object.entries(groupsData)) {
            const ref_groupWeekSubmissions = "incoming-v4/" + groupName + "/" + getDBRefOfCurrentWeekName()
            console.log(ref_groupWeekSubmissions)
            admin.database().ref(ref_groupWeekSubmissions).once('value', (snapshot) => { })
                .then((snapshot) => {
                    const groupWeekSubmissions = snapshot.val()
                    if (groupWeekSubmissions == null) return;
                    var registeredNumbers = []
                    for (const [key, submission] of Object.entries(groupWeekSubmissions)) {
                        registeredNumbers.push(submission.phoneNumber)
                    }

                    admin.database().ref("approvedNumbers").once('value', (snapshot2) => {

                        const userData = snapshot2.val()
                        //flatten users to list of phone numbers
                        var allUsersInGroup = []
                        for (const [userKey, userValue] of Object.entries(userData)) {
                            if (userValue.groups != null && userValue.groups.includes(groupName)) {
                                allUsersInGroup.push({ "phoneNumber": userKey, "name": userValue.name })
                            }
                        }

                        var procrastinators = allUsersInGroup.filter((user) => !registeredNumbers.includes(user.phoneNumber));
                        console.log("procrastinators in group " + groupName)
                        console.log(procrastinators)
                        var numbersOnly = procrastinators.map((user) => user.phoneNumber)
                        getNotificationGroup(numbersOnly).then(registrationTokens => {
                            const message = {
                                "notification": {
                                    "title": "Sign up for next week",
                                    "body": "You have not yet signed up for next week. The schedule closes at 8pm Sunday."
                                },
                                "tokens": registrationTokens,
                            };
                            sendNotificationsToGroup(message, registrationTokens, null)
                        });

                    })


                })
        }
    })
}





function runSort(snapshot, location, key) {
    const original = snapshot.after.val()

    var groups = tennisSort(original)
    return admin.database().ref(location).child(key).set(groups)
}

function processLateSubmission(snapshot, writeLocation) {
    const original = snapshot.after.val()

    console.log(writeLocation)
    return admin.database().ref(writeLocation).once('value', (snapshot) => {
        const data = snapshot.val()
        var existingCount = 0
        if (data != null) {
            existingCount = data.length
        }
        const newPlayerRef = writeLocation + "/" + existingCount
        const newPlayerObj = { "name": original.name, "phoneNumber": original.phoneNumber }//todo
        console.log("adding player " + JSON.stringify(newPlayerObj) + " to " + newPlayerRef)
        admin.database().ref(newPlayerRef).set(newPlayerObj)
    })
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
        sendNotificationsToGroup(message, registrationTokens, res)
    });
}

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
                sendNotificationsToGroup(message, registrationTokens, res)
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
                sendNotificationsToGroup(message, registrationTokens, res)
            })
        })
    }
}


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

function sendNotificationsToGroup(message, registrationTokens, res) {
    admin.messaging().sendMulticast(message)
        .then((response) => {
            if (response.failureCount > 0) {
                const failedTokens = [];
                response.responses.forEach((resp, idx) => {

                    if (!resp.success) {
                        failedTokens.push(registrationTokens[idx]);
                    }
                });
                console.log('List of tokens that caused failures: ' + failedTokens);
                if (res != null) {
                    res.end('List of tokens that caused failures: ' + failedTokens)
                }
            } else {
                console.log("No errors sending messages")
                if (res != null) {
                    res.end("No errors sending messages")
                }
            }
        })
}


function Combinations(arr, r) {
    // To avoid object referencing, cloning the array.
    arr = arr && arr.slice() || [];

    var len = arr.length;

    if (!len || r > len || !r)
        return [[]];
    else if (r === len)
        return [arr];

    if (r === len) return arr.reduce((x, v) => {
        x.push([v]);

        return x;
    }, []);

    var head = arr.shift();

    return Combinations(arr, r - 1).map(x => {
        x.unshift(head);

        return x;
    }).concat(Combinations(arr, r));
}


function tennisSortBySkill(data, playerInfoMap) {
    let uniqueData = removeDuplicates(data)
    //make a map for each day with key as name of day
    const daysAvailable = {}

    for (const [key, playerSubmission] of Object.entries(uniqueData)) {
        //for each nonnull choice, add item to map using choice as key
        // console.log("item: " + JSON.stringify(item))
        const choices = playerSubmission.choices;
        for (let index = 0; index < choices.length; index++) {
            const choice = choices[index];
            addChoiceToDay(playerSubmission, choice)
        }
    }
    // console.log(JSON.stringify(daysAvailable))


    function addChoiceToDay(playerSubmission, key) {
        console.log("playerInfoMap")
        console.log(JSON.stringify(playerInfoMap))
        const ranking = playerInfoMap[playerSubmission.phoneNumber]
        let utr = 40
        let goodwill = 1
        if (ranking != null) {
            utr = ranking.utr
            ranking.goodwill
        }
        daysAvailable[key] = daysAvailable[key] ?? [];
        daysAvailable[key].push({ "name": playerSubmission.name, "phoneNumber": playerSubmission.phoneNumber, "maxDays": playerSubmission.maxDays, "utr": utr, "goodwill": goodwill });
    }

    const weeklyMatches = {}
    while (Object.keys(daysAvailable).length > 0) {
        const topComboOfWeek = findBestMatches(daysAvailable);
        if (topComboOfWeek == undefined) {
            break;
        }
        const key = Object.keys(topComboOfWeek)[0]
        delete daysAvailable[key]
        Object.assign(weeklyMatches, topComboOfWeek)
        // topComboOfWeek[key].players.length
        reduceGoodwillForChosenPlayers(topComboOfWeek, key);
    }


    for (const [key, item] of Object.entries(weeklyMatches)) {
        console.log(key + "-" + getPlayerSummary(item.players)
            + " \n " + JSON.stringify(item.stats))
    }
    return weeklyMatches;


    function reduceGoodwillForChosenPlayers(topComboOfWeek, key) {
        let upperBound = topComboOfWeek[key].players.length < 4 ? topComboOfWeek[key].players.length : 4
        for (let index = 0; index < upperBound; index++) {
            const chosenPlayer = topComboOfWeek[key].players[index];
            for (const [key, day] of Object.entries(daysAvailable)) {
                var playerCount = 0;
                for (const [key, player] of Object.entries(day)) {
                    if (player.phoneNumber === chosenPlayer.phoneNumber) {
                        player.maxDays = chosenPlayer.maxDays - 1;
                        if (player.maxDays == 0) {
                            player.goodwill = 0;
                        } else {
                            player.goodwill = (player.goodwill) / 2;
                        }
                        console.log(chosenPlayer.name + " goodwill reduced by half");
                    }
                }
            }
        }
    }

    function findBestMatches(daysAvailable) {

        const allCombos = new Map();
        //find all combinations for each day
        for (const [key, allPlayers] of Object.entries(daysAvailable)) {//daysAvailable = {"Monday": [{name: "5412078581", "utr": 5.5}]}
            var combos
            if (allPlayers.length < 4) {
                combos = [allPlayers];
            } else {
                combos = Combinations(allPlayers, 4); //item = {name: "5412078581", "utr": 5.5}
            }
            allCombos.set(key, sortCombosByHighestQuality(combos, allPlayers)); //allCombos = {"Monday": [{"1,4,2,3"}, {"1,3,2,5"}], "Tuesday"...}
        }

        var topComboOfWeek; // {"Monday": {"1,4,2,3"}}
        var topComboOfWeekKey;
        for (const [key, dayCombos] of allCombos) {
            const topComboPerDay = dayCombos[0];
            if (topComboOfWeek == undefined) {
                topComboOfWeek = { [key]: topComboPerDay }
                topComboOfWeekKey = key
            }
            else if (topComboPerDay.stats.quality > topComboOfWeek[topComboOfWeekKey].stats.quality) {
                topComboOfWeek = { [key]: topComboPerDay };
                topComboOfWeekKey = key
            }
        }

        return topComboOfWeek
    }

}

function sortCombosByHighestQuality(combinations, allSignupsForDay) {
    var matchesByQuality = [];
    for (let index = 0; index < combinations.length; index++) {
        const players = combinations[index];
        //if less than 4 players for a day, then there are no combos to sort
        if (players.length < 4) {
            matchesByQuality.push({ "players": players, stats: { "quality": -1, "closeness": 0, "balance": 0, "bias": 0 } })
        } else {
            let alternates = allSignupsForDay.filter(x => !players.includes(x))
            const sortedPlayers = players.sortBy(i => i.utr);
            sortedPlayers.push.apply(sortedPlayers, alternates)
            const teamAutr = sortedPlayers[0].utr + sortedPlayers[3].utr
            const teamButr = sortedPlayers[1].utr + sortedPlayers[2].utr
            const balance = outOfPossible(13, Math.abs(teamAutr - teamButr))
            const closeness = outOfPossible(15, calculateCloseness(sortedPlayers))
            const bias = (sortedPlayers[0].goodwill + sortedPlayers[1].goodwill + sortedPlayers[2].goodwill + sortedPlayers[3].goodwill) / 4
            const quality = (balance + closeness) * bias
            matchesByQuality.push({ "players": sortedPlayers, stats: { "quality": quality, "closeness": closeness, "balance": balance, "bias": bias } })
        }
    }
    return matchesByQuality.sortBy(i => i.stats.quality);

    function calculateCloseness(array) {
        return ((array[0].utr + array[1].utr + array[2].utr + array[3].utr) / 4) - array[3].utr

    }

    function outOfPossible(possible, actual) {
        const outOf10 = possible - actual
        if (outOf10 <= 0) {
            return 1
        } else return outOf10 / (possible / 10)
    }

}
function getPlayerSummary(element) {
    if (element.length < 4) return ""
    return element[0].name + "+" + element[3].name + " vs. " + element[1].name + "+" + element[2].name
}



function tennisSort(data) {
    console.log("tennisSort")
    console.log(JSON.stringify(data))
    let uniqueData = removeDuplicates(data)

    var playerCount = 0
    let sortedListsMap = {}

    for (const [key, item] of Object.entries(uniqueData)) {
        playerCount++
        for (let index = 0; index < item.choices.length; index++) {
            const choice = item.choices[index];
            const listName = "sorted" + index
            const list = sortedListsMap[listName] ?? []
            const object = buildSortedObjectFull(choice, item, index + 1)
            if (index % 2 == 0) {
                list.push(object)
            } else {
                list.unshift(object)
            }
            sortedListsMap[listName] = list
        }
    }


    let sortedList = [];
    for (const [key, list] of Object.entries(sortedListsMap)) {
        sortedList = sortedList.concat(list)
    }

    let daysMap = {}

    sortedList.forEach(playerPreference => {
        let person = uniqueData.find(x => x.phoneNumber == playerPreference.phoneNumber)
        let hasReachedMaxDays = person.maxDays == person.scheduledDays
        if (hasReachedMaxDays) {
            console.log("skipping " + person.name + " who is already scheduled for " + person.scheduledDays + " days")
            return
        }

        let playerCountForDay = 8
        let addedAsAlternate = false
        let day = daysMap[playerPreference.day] ?? []
        day.push(buildSortedObject(playerPreference))
        daysMap[playerPreference.day] = day

        if (!hasReachedMaxDays && !addedAsAlternate) {
            person.scheduledDays++
        }
    })

    return daysMap

}

function hasNonFoursome(length) {
    return length % 4 == 0
}

function removeDuplicates(data) {
    var firebaseId = []
    var uniquePlayers = []
    //iterate through data 
    for (const [key, item] of Object.entries(data)) {
        let cleanNumber = item.firebaseId.toString().replace(/\D/g, '')
        if (firebaseId.includes(cleanNumber)) {
            console.log("firebaseIds include: " + cleanNumber)
            uniquePlayers = uniquePlayers.filter(f => cleanNumber !== f.firebaseId.toString().replace(/\D/g, ''))
        }
        item.scheduledDays = 0
        firebaseId.push(cleanNumber)
        uniquePlayers.push(item)


    }
    return uniquePlayers
}


function buildSortedObjectFull(day, item, choice) {
    var phoneNumber = "Unknown"
    if (item.phoneNumber != undefined) {
        phoneNumber = item.phoneNumber
    }
    var hasSunpro = false
    console.log("Item.hasSunpro " + item.sunPro)
    if (item.sunPro === "Yes") {//replace with tab tracker
        hasSunpro = true
    }
    return { "day": day, "name": item.name + " (" + choice + ")", "phoneNumber": phoneNumber, "hasSunpro": hasSunpro }
}
function buildSortedObject(pair) {
    var name = pair.name
    return { "name": name, "phoneNumber": pair.phoneNumber }
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