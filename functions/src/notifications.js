module.exports.run_markNotComingNotification = run_markNotComingNotification;
module.exports.run_scheduledToPlayReminderForAllGroups = run_scheduledToPlayReminderForAllGroups;
module.exports.run_procastinatorNotification = run_procastinatorNotification;
module.exports.run_signupStatusNotification = run_signupStatusNotification;
module.exports.run_groupSignupStatusNotification = run_groupSignupStatusNotification;
module.exports.getFirebaseIdsInGroup = getFirebaseIdsInGroup;
module.exports.sendNotificationsToGroup = sendNotificationsToGroup;
module.exports.getRegistrationTokensFromFirebaseIds = getRegistrationTokensFromFirebaseIds;
module.exports.filterByNotificationPreference = filterByNotificationPreference;
module.exports.groupIdFromWeekPath = groupIdFromWeekPath;
module.exports.run_matchingSlotsNotification = run_matchingSlotsNotification;

const admin = require("firebase-admin");
const index = require("./index.js")
const utilities = require("./utilities.js");
const scheduleTiming = require("./scheduleTiming.js");

/**The categories a member can switch off for one group, from the app's
 * notification settings page. Stored at
 * member_rankings/{groupId}/{firebaseId}/notifications. */
const NOTIFICATION_CATEGORIES = {
    scheduleActivity: "scheduleActivity",
    //when-is-good groups only: someone signed up over a slot of yours
    matchingSlots: "matchingSlots",
    //every algorithm but when-is-good: the sort has put you down to play
    playReminders: "playReminders",
};
//exported here rather than with the functions at the top: a const is not
//hoisted, so reading it up there throws before this line runs
module.exports.NOTIFICATION_CATEGORIES = NOTIFICATION_CATEGORIES;

/**Whether a group running algorithm sends category at all.
 *
 * Matching slots and play reminders are two answers to the same question —
 * "the schedule moved, does it concern you?" — and which one a group can
 * answer follows from how it sorts. The app only offers the applicable one,
 * so the other is off here: a member has no switch to turn it back on, and a
 * notification nobody can decline is not a preference. */
function groupSendsCategory(algorithm, category) {
    if (category === NOTIFICATION_CATEGORIES.matchingSlots) return algorithm === "whenIsGood";
    if (category === NOTIFICATION_CATEGORIES.playReminders) return algorithm !== "whenIsGood";
    return true;
}
module.exports.groupSendsCategory = groupSendsCategory;

/**How groupId sorts, or null if the group is gone. Read straight from the
 * group node so it cannot drift from what the app shows the member. */
async function sortingAlgorithmOf(groupId) {
    return (await admin.database().ref("groups-v2").child(groupId).child("sortingAlgorithm").once('value')).val()
}

/**Drops the members of groupId who are not down for category.
 *
 * A category the group's algorithm does not send goes to nobody, whatever is
 * stored — the app hides that switch, so a stored true there only means the
 * member once used a build that showed it, or saved the neighbouring switch
 * and wrote the whole node.
 *
 * On a category the group does send, only an explicit false counts as off: a
 * member with no stored node, or a node that predates this category, hears
 * everything — which is what they got before the setting existed. A read
 * failure leaves the list alone for the same reason; a database hiccup must
 * never silence a whole group. */
async function filterByNotificationPreference(groupId, firebaseIds, category) {
    if (firebaseIds == null || firebaseIds.length == 0) return [];
    if (groupId == null || groupId === "") return firebaseIds;
    try {
        const algorithm = await sortingAlgorithmOf(groupId)
        if (!groupSendsCategory(algorithm, category)) {
            console.log("Group " + groupId + " sorts by " + algorithm + ", so '" + category + "' is off for everyone in it")
            return [];
        }
        const snapshot = await admin.database().ref("member_rankings").child(groupId).once('value')
        const rankings = snapshot.val() || {}
        const wanted = firebaseIds.filter((firebaseId) => {
            const preferences = (rankings[firebaseId] || {}).notifications
            return preferences == null || preferences[category] !== false
        })
        const optedOut = firebaseIds.length - wanted.length
        if (optedOut > 0) {
            console.log(optedOut + " of " + firebaseIds.length + " members in " + groupId + " have '" + category + "' off")
        }
        return wanted
    } catch (e) {
        console.error("Could not read notification preferences for " + groupId + ", sending to everyone: " + e)
        return firebaseIds
    }
}

/**A weekPath is "sorted-v6/{groupId}/{algorithm}/{week}", so the group is the
 * second segment. Returns null for anything shaped differently, which leaves
 * the send unfiltered rather than dropping it. */
function groupIdFromWeekPath(weekPath) {
    if (weekPath == null) return null;
    const segments = String(weekPath).split("/").filter((segment) => segment !== "")
    return segments.length > 1 ? segments[1] : null;
}

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
    //both notifications below are about a day you are down to play on
    const groupId = groupIdFromWeekPath(weekPath)
    const today = new Date()
    const offsetHours = data.offsetHours ? data.offsetHours : -6
    const dayNumber = utilities.dayOfWeekAsInteger(dayName)
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
            const recipients = await filterByNotificationPreference(groupId, firebaseIds, NOTIFICATION_CATEGORIES.playReminders)
            await getRegistrationTokensFromFirebaseIds(recipients).then(registrationTokens => {
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
            const recipients = await filterByNotificationPreference(groupId, firebaseIds, NOTIFICATION_CATEGORIES.playReminders)
            await getRegistrationTokensFromFirebaseIds(recipients).then(registrationTokens => {
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

/**Signup status for a single group. Groups open and close on their own
 * schedule, so only that group's members hear about it. */
async function run_groupSignupStatusNotification(groupId, title, body) {
    const members = await getFirebaseIdsInGroup(groupId)
    const firebaseIds = await filterByNotificationPreference(groupId, members, NOTIFICATION_CATEGORIES.scheduleActivity)
    if (firebaseIds.length == 0) {
        console.log("Nobody in group " + groupId + " to tell, skipping '" + title + "'")
        return;
    }
    const registrationTokens = await getRegistrationTokensFromFirebaseIds(firebaseIds)
    const message = {
        "notification": {
            "title": title,
            "body": body
        },
        "tokens": registrationTokens,
    };
    await sendNotificationsToGroup(message, registrationTokens)
}

/**"Potential matchup" — someone signed up over a slot of yours.
 *
 * Only when-is-good groups have slots to collide, so this is a no-op anywhere
 * else. Called with the incoming-v4 week node from either side of a write:
 * anything keyed in after but not in before is a submission that just landed.
 *
 * A member who resubmits only announces the slots they did not already have,
 * so tweaking your availability doesn't re-ping everyone you already matched.
 *
 * The body names the window that collided, so recipients go in one send per
 * window rather than one for the whole submission. Somebody who matched on
 * more than one hears about the first of them: two pushes for one signup reads
 * as a bug, and the schedule has the rest. */
async function run_matchingSlotsNotification(groupId, before, after) {
    if (after == null) return;
    const algorithm = await sortingAlgorithmOf(groupId)
    if (!groupSendsCategory(algorithm, NOTIFICATION_CATEGORIES.matchingSlots)) {
        console.log("Group " + groupId + " sorts by " + algorithm + ", no slots to match")
        return;
    }
    const beforeWeek = before || {}
    const newKeys = Object.keys(after).filter((key) => beforeWeek[key] == null)
    if (newKeys.length == 0) {
        console.log("No new submissions in " + groupId + ", nothing to match")
        return;
    }
    for (const key of newKeys) {
        await announceSubmission(after[key], key)
    }

    async function announceSubmission(submission, key) {
        if (submission == null || submission.firebaseId == null) return;
        const announced = newSlotsIn(submission, latestSubmissionFor(beforeWeek, submission.firebaseId))
        if (announced.length == 0) {
            console.log(submission.firebaseId + " resubmitted with nothing new")
            return;
        }
        //everyone else's newest submission, including ones made earlier in the week
        const others = latestSubmissionsByMember(after, submission.firebaseId)
        const byWindow = new Map()
        for (const other of others) {
            const slot = firstOverlapping(announced, slotsOf(other))
            if (slot == null) continue;
            const window = labelOf(slot)
            if (!byWindow.has(window)) byWindow.set(window, [])
            byWindow.get(window).push(other.firebaseId)
        }
        if (byWindow.size == 0) {
            console.log("No overlapping slots for " + submission.firebaseId + " in " + groupId)
            return;
        }
        const name = nameOf(submission)
        for (const [window, matched] of byWindow) {
            const recipients = await filterByNotificationPreference(groupId, matched, NOTIFICATION_CATEGORIES.matchingSlots)
            const registrationTokens = await getRegistrationTokensFromFirebaseIds(recipients)
            const message = {
                "notification": {
                    "title": "Potential matchup",
                    "body": name + " is available " + window
                },
                "tokens": registrationTokens,
            };
            await sendNotificationsToGroup(message, registrationTokens)
        }
    }
}

/**Who the body names. Shortened the way the schedule shortens it, so the push
 * and the slot it points at agree on what somebody is called. A submission
 * with no name still gets sent — the window is the useful half. */
function nameOf(submission) {
    const name = submission.name
    if (name == null || String(name).trim() === "") return "Someone";
    return utilities.shortenedName(String(name).trim())
}

/**What to call a slot in the body. The app sends the label the member picked
 * the window by ("Tuesday 8am - 10am"); slots painted on the calendar have no
 * label, so those are named the way the app names them. */
function labelOf(slot) {
    const label = slot.label
    if (label != null && String(label).trim() !== "") return String(label).trim();
    return [dayLabel(slot.dayOfWeek), timeLabel(slot.startTime) + "-" + timeLabel(slot.endTime)]
        .filter((part) => part !== "")
        .join(" ")
}

/**Days are stored as the enum name, "tuesday". */
function dayLabel(dayOfWeek) {
    if (dayOfWeek == null) return "";
    const day = String(dayOfWeek)
    return day.charAt(0).toUpperCase() + day.slice(1)
}

/**"8.45" is 8:45, and "8.00" reads as 8:00 rather than 8.0. */
function timeLabel(time) {
    const minutes = minutesOf(time)
    if (minutes == null) return String(time == null ? "" : time);
    const hour = Math.floor(minutes / 60)
    return hour + ":" + String(minutes % 60).padStart(2, "0")
}

/**The first of slotsA that touches anything in slotsB, or null. */
function firstOverlapping(slotsA, slotsB) {
    return slotsA.find((a) => slotsB.some((b) => overlaps(a, b))) || null
}

function slotsOf(submission) {
    const slots = submission == null ? null : submission.availableSlots
    if (slots == null) return [];
    //written as a list, but firebase hands back a map when keys are sparse
    return Object.values(slots).filter((slot) => slot != null)
}

/**Start and end are stored as "h.mm" strings, so they are read as clock times
 * rather than numbers — "8.45" is 8:45, not a fraction of an hour. */
function minutesOf(time) {
    if (time == null) return null;
    const [hours, minutes] = String(time).split(".")
    const hour = parseInt(hours, 10)
    if (isNaN(hour)) return null;
    return hour * 60 + (parseInt(minutes, 10) || 0)
}

/**Two slots touch when they share a day and their times cross at all. */
function overlaps(a, b) {
    if (a.dayOfWeek !== b.dayOfWeek) return false;
    const aStart = minutesOf(a.startTime)
    const aEnd = minutesOf(a.endTime)
    const bStart = minutesOf(b.startTime)
    const bEnd = minutesOf(b.endTime)
    if (aStart == null || aEnd == null || bStart == null || bEnd == null) return false;
    return aStart < bEnd && bStart < aEnd
}

/**The slots in submission that the member had not already posted. */
function newSlotsIn(submission, previous) {
    const already = slotsOf(previous)
    return slotsOf(submission).filter(
        (slot) => !already.some((old) =>
            old.dayOfWeek === slot.dayOfWeek &&
            String(old.startTime) === String(slot.startTime) &&
            String(old.endTime) === String(slot.endTime)),
    )
}

/**Submission keys are the epoch millis of the submission, so the larger key is
 * the newer entry. */
function isNewerKey(key, than) {
    const a = parseInt(key, 10)
    const b = parseInt(than, 10)
    if (!isNaN(a) && !isNaN(b)) return a > b;
    return String(key) > String(than)
}

/**A member's newest entry in a week node. Submitting appends rather than
 * replaces, so a member who submits twice leaves two entries behind. */
function latestSubmissionFor(week, firebaseId) {
    let latest = null;
    let latestKey = null;
    for (const [key, submission] of Object.entries(week || {})) {
        if (submission == null || submission.firebaseId !== firebaseId) continue;
        if (latestKey == null || isNewerKey(key, latestKey)) {
            latest = submission
            latestKey = key
        }
    }
    return latest;
}

/**Everyone but exceptId, each as their newest submission. */
function latestSubmissionsByMember(week, exceptId) {
    const byMember = {}
    for (const [key, submission] of Object.entries(week || {})) {
        if (submission == null || submission.firebaseId == null) continue;
        if (submission.firebaseId === exceptId) continue;
        const held = byMember[submission.firebaseId]
        if (held == null || isNewerKey(key, held.key)) {
            byMember[submission.firebaseId] = { key: key, submission: submission }
        }
    }
    return Object.values(byMember).map((entry) => entry.submission)
}

async function getFirebaseIdsInGroup(groupId) {
    const snapshot = await admin.database().ref("approvedNumbers").once('value')
    const data = snapshot.val() || {}
    var firebaseIds = []
    for (const [userKey, userValue] of Object.entries(data)) {
        //a user's groups have been written as both a list and a map over time
        const groups = userValue.groups == null ? [] : Object.values(userValue.groups)
        if (groups.includes(groupId)) {
            firebaseIds.push(userKey)
        }
    }
    return firebaseIds
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
    if (registrationTokens.length == 0) {
        console.log("No registration tokens, aborting send")
        return
    }
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
                const recipients = await filterByNotificationPreference(key, firebaseIds, NOTIFICATION_CATEGORIES.playReminders);
                await getRegistrationTokensFromFirebaseIds(recipients).then(async (registrationTokens) => {
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
                        const preferences = scheduleTiming.preferencesFor(groupValue)
                        //this is the schedule nagging you about itself, so it follows the schedule opt-out
                        const recipients = await filterByNotificationPreference(groupId, firebaseIdsOnly, NOTIFICATION_CATEGORIES.scheduleActivity)
                        await getRegistrationTokensFromFirebaseIds(recipients).then(registrationTokens => {
                            const message = {
                                "notification": {
                                    "title": "Sign up for next week",
                                    "body": "You have not yet signed up for next week for " + groupValue.name + ". The schedule closes " + preferences.signupCloseDay + " at " + preferences.signupCloseTime + "."
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
