const functions = require("firebase-functions");
const admin = require("firebase-admin");
const utilities = require('./utilities.js')
const notifications = require('./notifications.js')
const utr = require('./utr_updates.js')

module.exports.processLateSubmission = processLateSubmission;
module.exports.createUser = createUser;
module.exports.joinGroupRequest = joinGroupRequest;
module.exports.toggleAdmin = toggleAdmin;
module.exports.approveJoinRequest = approveJoinRequest;
module.exports.approveSetRequest = approveSetRequest;
module.exports.modifyGroupMember = modifyGroupMember;
module.exports.inviteUserToGroup = inviteUserToGroup;
module.exports.deleteAccount = deleteAccount;
module.exports.deleteGroup = deleteGroup;


/**
 * When a user signs up to the app, this function is called to create a user object in the database.
 * This function is also called when a user starts the app to update their firebase tokens
 * @param phoneNumber - the user's phone number (optional and can replace the email as the unique identifier)
 * @param name - the user's name
 * @param firebaseId - the user's firebase id
 * @param email - the user's email (optional and can replace the phone number as the unique identifier)
 * @param tokens - the user's firebase tokens
 */
function createUser(req, res) {
    const body = req.body.data;
    console.log("body: " + JSON.stringify(body))
    if (body.firebaseId == null || body.name == null || (body.phoneNumber == null && body.email == null)) {
        res.status(400).send({ "data": { "result": "failure", "reason": "firebaseId, name and either phoneNumber or email are required" } })
        return;
    }
    //check for existing user with id as phone number
    //if none, query all objects to see if email is in any user objects
    admin.database().ref("approvedNumbers").once('value', async (snapshot) => {
        //loop results
        const allUsers = snapshot.val();
        for (const [key, serverUser] of Object.entries(allUsers)) {
            if ((body.phoneNumber != null && body.phoneNumber == serverUser.phoneNumber) ||
                (body.email != null && body.email == serverUser.email)) {
                //if found existing user, update tokens and last visited and return
                if (body.tokens != null) {
                    serverUser.tokens = Object.assign(serverUser.tokens ?? {}, body.tokens);
                }
                //create new human readable UTC date timestamp
                serverUser.lastVisited = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });
                serverUser.firebaseId = key;
                serverUser.appVersion = body.appVersion;
                console.log("serverUser: " + JSON.stringify(serverUser))
                console.log("key: " + key)
                admin.database().ref("approvedNumbers").child(key).update(serverUser);
                res.status(200).send({ "data": serverUser });
                return;
            }
        }
        //check invitedUsers table and add any outstanding groups
        let invitedUserSnapshot = await admin.database().ref("invitedUsers").once('value', (snapshot) => {
            const invitedUsers = snapshot.val();
            return invitedUsers;
        });
        let preExistingGroups = []
        if (invitedUserSnapshot.val() != null) {
            const data = invitedUserSnapshot.val()
            for (const [key, invitedUser] of Object.entries(data)) {
                if (key == body.phoneNumber) {
                    for (const [pushKey, invite] of Object.entries(invitedUser)) {
                        console.log("invite: " + JSON.stringify(invite))
                        //add all groups distinctly
                        preExistingGroups = preExistingGroups.includes(invite.group) ? preExistingGroups : [...preExistingGroups, invite.group]
                    }
                }
            }
            console.log("preExistingGroups: " + JSON.stringify(preExistingGroups))
        }

        const newUser = {
            name: body.name,
            email: body.email ?? null,
            phoneNumber: body.phoneNumber ?? null,
            firebaseId: body.firebaseId,
            groups: preExistingGroups,
        };
        console.log("newUser: " + JSON.stringify(newUser))
        admin.database().ref("approvedNumbers").child(body.firebaseId).set(newUser);
        res.status(200).send({ "data": newUser });
    })
};

/**
 * When a user wants to join a group, either public or private, this function is called to add the user to the group.
 * If the group is private, a join request object is made and the admin of the group is notified.
 * If the group is public, the user is added to the group.
 * If the user has already been invited to the group, the user is added to the group.
 * @param {*} req 
 * @param {*} res 
 */
async function joinGroupRequest(req, res) {
    const body = req.body.data;
    await admin.database().ref("groups-v2").child(body.groupId).once('value', async (snapshot) => {
        const group = snapshot.val();
        if (group == null) {
            res.status(400).send({ "data": { "result": "failure", "reason": "group not found" } })
            return;
        }
        if (group.visibility == "public") {
            //append groupId to user's list of groups
            addGroupToUser();
        } else if (group.visibility == "private" || group.visibility == "unlisted") {//unlisted is just for testing.
            const request = {
                "userId": body.userId, "status": "pending", "dateInitiated": new Date().getTime(), "groupId": body.groupId
            }

            //find any existing, pending and delete
            await admin.database().ref("joinRequests").child(body.groupId).once('value', async (snapshot) => {
                const allRequests = snapshot.val() ?? {};
                //delete any existing so we don't have duplicates
                for (const [key, request] of Object.entries(allRequests)) {
                    if (request.userId == body.userId && request.status == "pending") {
                        admin.database().ref("joinRequests").child(body.groupId).child(key).remove()
                    }
                }
                //add new request
                admin.database().ref("joinRequests").child(body.groupId).push(request)
                console.log("notifying admins...")
                // notify admins
                let adminIds = Object.values(group.admins)
                console.log("adminIds: " + JSON.stringify(adminIds))
                const message = { "notification": { "title": "New join request", "body": "A new user has requested to join " + group.name + ". Tap to view the request." } };

                await notifications.sendNotificationsToGroup(message, await notifications.getRegistrationTokensFromFirebaseIds(adminIds))
            }).then(() => {
                res.send({ "data": { "result": "pending" } })
            })
        }
    }).catch((error) => { console.error(error); res.send(500, { "data": { "result": "failure", "reason": error } }); });

    function addGroupToUser() {
        admin.database().ref("approvedNumbers").child(body.userId).child('groups').once('value', (snapshotGroups) => {
            var groups = snapshotGroups.val();
            if (groups == null) {
                groups = [];
            }
            if (groups.includes(body.groupId)) {
                res.send({ "data": { "result": "failure", "reason": "already in group" } });
            } else {
                //create member_ranking for this user
                admin.database().ref("member_rankings").child(body.groupId).child(body.userId).set({ "utr": 4, "goodwill": 1 })

                groups.push(body.groupId);
                admin.database().ref("approvedNumbers").child(body.userId).child("groups").set(groups);
                res.send({ "data": { "result": "success" } });
            }
        });
    }
}


function toggleAdmin(req, res) {
    const body = req.body.data;
    //lookup group
    admin.database().ref("groups-v2").child(body.groupId).once('value', (snapshot) => {
        const group = snapshot.val();
        if (group == null) {
            res.send(400, { "data": { "result": "failure", "reason": "group not found" } })
            return;
        }
        //check that user is admin of group
        if (!Object.values(group.admins).includes(body.adminId)) {
            res.send(401, { "data": { "result": "failure", "reason": "user is not admin" } })
            return;
        }

        if (group.admins.includes(body.userId)) {
            //make sure there are at least 2 admins before removing one
            if (group.admins.length == 1) {
                res.send(400, { "data": { "result": "failure", "reason": "cannot remove last admin" } })
                return;
            }
            //remove userId from list of admins
            const index = group.admins.indexOf(body.userId);
            if (index > -1) {
                group.admins.splice(index, 1);
            }
        } else {
            //add userId to list of admins
            group.admins.push(body.userId)
        }
        admin.database().ref("groups-v2").child(body.groupId).child("admins").set(group.admins)
        res.send({ "data": { "result": "success" } })
    });
}

async function approveSetRequest(req, res) {
    console.log("req.body: " + JSON.stringify(req.body))
    const data = req.body.data;
    const groupId = data.groupId;
    const setId = data.pushId;
    const userId = data.userId;
    const approve = data.approve;
    const setData = await admin.database().ref("sets-v2").child(groupId).child(setId).once('value').then((snapshot) => { return snapshot.val() });
    console.log("setData: " + JSON.stringify(setData))
    var isAuthorized = false;
    if (approve == null || groupId == null || setId == null || userId == null) {
        res.sendStatus(400)
        return;
    }
    if (setData.verification != null && setData.verification.isVerified == true) {
        res.send({ "data": { "message": "set already verified" } })
        return;
    } else if (setData.contestation != null && setData.contestation.isContested == true) {
        res.send({ "data": { "message": "set is contested", "contestedBy": setData.contestation.contestedBy } })
        return;
    }
    await admin.database().ref("groups-v2").child(data.groupId).child("admins").once('value', (snapshot) => {
        //admins are always authorized
        const admins = Object.values(snapshot.val())
        console.log("admins: " + JSON.stringify(admins))
        if (admins.includes(userId)) {
            console.log("request user is admin")
            isAuthorized = true
        } else {
            console.log("checking if user can approve")
            if (setData.submittedBy == userId) {
                res.status(403).send({ "data": { "message": "cannot approve own set" } })
                return
            } else if (setData.winners.includes(setData.submittedBy)) {
                //a loser must approve this set
                console.log("winner submitted")
                if (setData.winners.includes(userId)) {
                    res.status(403).send({ "data": { "message": "cannot approve set submitted by teammate" } })
                    return
                }
                else if (!setData.losers.includes(userId)) {
                    res.status(403).send({ "data": { "message": "not part of set" } })
                    return
                } else if (setData.losers.includes(userId)) {
                    console.log("loser is authorized")
                    isAuthorized = true
                }
            } else if (setData.losers.includes(setData.submittedBy)) {
                //a winner must approve this set
                console.log("loser submitted")
                if (setData.losers.includes(userId)) {
                    res.status(403).send({ "data": { "message": "cannot approve set submitted by teammate" } })
                    return
                }
                else if (!setData.winners.includes(userId)) {
                    res.status(403).send({ "data": { "message": "not part of set" } })
                } else if (setData.winners.includes(userId)) {
                    console.log("winner is authorized")
                    isAuthorized = true
                }
            } else if (!setData.winners.includes(userId) && !setData.losers.includes(userId)) {
                res.status(403).send({ "data": { "message": "not part of set" } })
                return
            } else if (setData.winners.concat(setData.losers).includes(userId)) {
                console.log("possibly admin reported set, but verifier was player")
                isAuthorized = true
            }
        }
    });
    console.log("isAuthorized: " + isAuthorized)
    //create new result
    if (isAuthorized) {
        if (approve == true) {
            setData.verification = { isVerified: true, verifiedBy: userId, dateVerified: new Date().getTime() }
            admin.database().ref("sets-v2").child(groupId).child(setId).set(setData)
            await utr.createResultFromSet(setId, setData, groupId);
            res.status(200).send({ "data": { "message": "set verified", "setData": setData } })
        } else {
            setData.contestation = { isContested: true, contestedBy: userId, dateContested: new Date().getTime() }
            admin.database().ref("sets-v2").child(groupId).child(setId).set(setData)
            res.status(200).send({ "data": { "message": "set contested", "setData": setData } })
        }
        return;
    }
    res.status(401).send({ "data": { "message": "User not authorized" } })
}

async function approveJoinRequest(req, res) {
    const body = req.body.data;
    console.log("request body: " + JSON.stringify(body))
    admin.database().ref("joinRequests").child(body.groupId).child(body.pushId).once('value', async (snapshot) => {
        const joinRequest = snapshot.val()
        console.log("joinRequest: " + JSON.stringify(joinRequest))
        if (joinRequest == null) {
            res.send({ "data": { "result": "failure", "reason": "joinRequest not found" } })
        } else {
            let group = (await admin.database().ref("groups-v2").child(body.groupId).get()).val();
            //verify that user is admin
            const admins = group.admins
            if (!Object.values(admins).includes(body.adminId)) {
                console.log(body.adminId + " not found")
                res.sendStatus(401)
                return;
            }

            //change status of request to approved
            joinRequest.status = "approved"
            admin.database().ref("joinRequests").child(body.groupId).child(body.pushId).update(joinRequest)

            //append groupId to user's list of groups
            let userGroups = (await admin.database().ref("approvedNumbers").child(joinRequest.userId).child('groups').get()).val();
            if (userGroups == null) {
                userGroups = []
            }
            if (userGroups.includes(body.groupId)) {
                console.log("already in group, exiting")
                res.send({ "data": { "result": "failure", "reason": "already in group" } })
                return
            } else {
                userGroups.push(body.groupId)
                admin.database().ref("approvedNumbers").child(joinRequest.userId).child("groups").set(userGroups)
                res.send({ "data": { "result": "success", "userGroups": userGroups } })
            }

            console.log("create member_ranking for this user")
            admin.database().ref("member_rankings").child(body.groupId).child(joinRequest.userId).set({ "utr": 4, "goodwill": 1 })

            console.log("send notification to user")
            admin.database().ref("approvedNumbers").child(joinRequest.userId).once('value', (snapshot) => {
                const user = snapshot.val()
                console.log("user: " + JSON.stringify(user))
                notifications.getRegistrationTokensFromFirebaseIds([user.firebaseId]).then(registrationTokens => {
                    const message = {
                        "notification": {
                            "title": "You've been added to a group",
                            "body": "You have been added to " + group.name + ". Tap to view the group."
                        },
                        "tokens": registrationTokens
                    };
                    notifications.sendNotificationsToGroup(message, registrationTokens)
                })
            })

        }
    });
};


/**
 * This method is to invite an existing user to a new group or to invite a new user to a group. 
 * In the case of a new user, the phone number is added to the invitedUsers table.
 * In the case of an existing user, the user is added to the group and the member_ranking is created.
 * @param userPublicId - the user being invited to the group as entered by the user (only phone numbers supported). Since this value can be entered by an admin,
 * @param groupId - the group being invited to
 * @param adminId - the user who is inviting the new user
 * @param utr - the utr of the user being invited (optional). If null, a default 4.0 is used.
 * @param goodwill - the goodwill of the user being invited (optional). If null, a default 1.0 is used.
 */
function inviteUserToGroup(req, res) {
    const body = req.body.data;
    console.log("body: " + JSON.stringify(body))
    admin.database().ref('groups-v2').child(body.groupId).child("admins").once('value', (snapshot) => {
        const adminList = snapshot.val()
        if (body.userPublicId == undefined || body.userPublicId == null) {
            res.status(400).send({ "data": { "groupId": body.groupId, "userPublicId": body.userPublicId, "message": "userPublicId is required" } })
            return;
        }
        if (body.adminId == undefined || body.adminId == null) {
            res.status(400).send({ "data": { "groupId": body.groupId, "userPublicId": body.userPublicId, "message": "adminId is required" } })
            return;
        }
        var foundAdmin = false
        for (const [key, value] of Object.entries(adminList)) {
            if (value == body.adminId) {
                foundAdmin = true
            }
        }
        if (!foundAdmin) {
            console.log(body.adminId + " not found")
            res.status(401).send({ "data": { "groupId": body.groupId, "userPublicId": body.userPublicId, "message": "adminId is not an admin of this group" } })
            return;
        }
    }).then(() => {
        admin.database().ref("approvedNumbers").once('value', (snapshot) => {
            const users = snapshot.val()
            var foundUser = false
            for (const [key, user] of Object.entries(users)) {
                if (user.phoneNumber == body.userPublicId) {
                    console.log("Found user: " + JSON.stringify(user))
                    foundUser = true;
                    if (user.groups == null) {
                        user.groups = [body.groupId]
                        console.log("User updated with group: " + JSON.stringify(user))
                        admin.database().ref("approvedNumbers").child(key).update(user)
                        res.status(200).send({ "data": { "groupId": body.groupId, "userPublicId": body.userPublicId, "message": "Existing user added to first group" } })
                    } else if (user.groups.includes(body.groupId)) {
                        res.status(200).send({ "data": { "groupId": body.groupId, "userPublicId": body.userPublicId, "message": "User already in group" } })
                    } else {
                        user.groups.push(body.groupId)
                        console.log(user.groups)
                        admin.database().ref("approvedNumbers").child(key).update(user)
                        res.status(200).send({ "data": { "groupId": body.groupId, "userPublicId": body.userPublicId, "message": "Existing user added to new group" } })
                    }
                    //create member_ranking for this user
                    createMemberRanking(key);
                    return;
                }
            }
            if (!foundUser) {
                var newUser = { "group": body.groupId, "adminId": body.adminId, "dateInvited": new Date().getTime(), "publicId": body.userPublicId, "providedName": body.providedName }
                let pushKey = admin.database().ref("invitedUsers").child(body.userPublicId).push()
                pushKey.set(newUser)
                console.log("pushKey: " + JSON.stringify(pushKey))
                createMemberRanking(body.userPublicId);
                res.status(200).send({ "data": { "groupId": body.groupId, "userPublicId": body.userPublicId, "message": "User invited to group. Once they create an account they will be added to the group." } })
            }
        })
    })

    function createMemberRanking(key) {
        if (body.utr != null && body.goodwill != null) {
            admin.database().ref("member_rankings").child(body.groupId).child(key).set({ "utr": body.utr, "goodwill": body.goodwill });
        }
    }
}


/** This method is to update an existing group members utr, goodwill, or suspended value.
 * @param groupId - the specific group this user's data is being modified in. Only a user can modify their own data, but this is group/user data.
 * @param adminId - the admin of the group
 * @param utr - the utr of the user being updated
 * @param goodwill - the goodwill of the user being updated
 * @param suspended - whether the user is suspended from the group
 * @param firebaseId - the firebaseId of the user being modified. If this value cannot be provided, the invitedUserToGroup function should be called.
 */
async function modifyGroupMember(req, res) {
    try {
    const body = req.body ?? {};
    console.log("body:", JSON.stringify(body));

    // Validate required fields up front
    if (!body.adminId) {
      return res.status(400).json({ groupId: body.groupId, userPublicId: body.userPublicId, message: "adminId is required" });
    }
    if (!body.groupId) {
      return res.status(400).json({ userPublicId: body.userPublicId, message: "groupId is required" });
    }
    if (!body.firebaseId) {
      return res.status(400).json({ groupId: body.groupId, userPublicId: body.userPublicId, message: "firebaseId is required" });
    }

    const adminId = await utilities.sanitizeUserIdToFirebaseId(body.adminId);

    // Check that modifier is admin
    const adminsSnap = await admin.database().ref('groups-v2').child(body.groupId).child('admins').once('value');
    const adminList = adminsSnap.val() || {};
    console.log(adminsSnap.ref.toString());
    console.log("adminList:", JSON.stringify(adminList));

    const isAdmin = Object.values(adminList).some(v => v === adminId);
    if (!isAdmin) {
      console.log(adminId, "not found in admins");
      return res.status(403).json({ groupId: body.groupId, userPublicId: body.userPublicId, message: "adminId is not an admin of this group" });
    }

    console.log(`validated adminId: ${adminId}`);
    console.log(`updating member ranking for user: ${body.firebaseId} in group: ${body.groupId} with utr: ${body.utr} goodwill: ${body.goodwill} suspended: ${body.suspended}`);

    await admin.database()
      .ref("member_rankings")
      .child(body.groupId)
      .child(body.firebaseId)
      .update({ utr: body.utr, goodwill: body.goodwill, suspended: body.suspended });

    return res.status(200).json({ groupId: body.groupId, userPublicId: body.userPublicId, message: "User updated" });
  } catch (err) {
    console.error("modifyGroupMember error:", err);
    // Ensure we only try to respond if headers aren't already sent
    if (!res.headersSent) {
      return res.status(500).json({ message: "Internal server error" });
    }
    // If headers already sent, just log — Express will handle the rest
  }
}

function deleteAccount(req, res) {
    const db = admin.database();
    console.log("req.body: " + JSON.stringify(req.body))
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
                    //if group only has 1 admin, delete group
                    const adminList = snapshot.val()
                    if (adminList.length == 1) {
                        console.log("only 1 admin in group. removing group: " + group)
                        db.ref("groups-v2").child(group).remove()
                        removedLog.push("groups-v2." + group)
                        return;
                    }
                    //if user is admin, remove them from the list
                    console.log("adminList: " + JSON.stringify(adminList))
                    for (const [key, value] of Object.entries(adminList)) {
                        console.log("key: " + key + " value: " + value)
                        if (value == body.userId) {
                            adminList[key] = value + "_deleted"
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
                            db.ref("joinRequests").child(group).child(key).remove()
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
        console.log("removedLog: " + removedLog)
        res.send({ "data": { "result": "success", "log": removedLog } })
    });
};

async function deleteGroup(req, res) {
    const db = admin.database();
    const body = req.body;
    console.log("req.body: " + JSON.stringify(req.body))
    const groupId = body.groupId;
    const adminId = body.adminId;

    const removedLog = [];
    console.log("deleteGroup called with groupId: " + groupId + " adminId: " + adminId)

    if (!groupId || !adminId || groupId.length == 0 || adminId.length == 0) {
        res.status(400).send({ result: 'failure', reason: 'missing groupId/adminId' });
        return;
    }

    // 1) Fetch & validate
    const groupSnap = await db.ref('groups-v2').child(groupId).once('value');
    const group = groupSnap.val();

    if (!group) {
        res.status(400).send({ result: 'failure', reason: 'group not found' });
        return;
    }
    if (!group.admins || !Object.values(group.admins).includes(adminId)) {
        res.status(400).send({ result: 'failure', reason: 'user is not admin' });
        return;
    }

    // 2) Stage writes
    const tasks = [];

    // remove group
    tasks.push(
        db.ref('groups-v2').child(groupId).remove().then(() => {
            removedLog.push(`groups-v2.${groupId}`);
        })
    );

    // remove member rankings
    tasks.push(
        db.ref('member_rankings').child(groupId).remove().then(() => {
            removedLog.push(`member_rankings.${groupId}`);
        })
    );

    // remove join requests (simplified)
    tasks.push(
        db.ref('joinRequests').child(groupId).remove().then(() => {
            removedLog.push(`joinRequests.${groupId}`);
        })
    );

    // remove group from all users
    tasks.push(
        db.ref('approvedNumbers').once('value').then((snap) => {
            const users = snap.val() || {};
            const updates = {};
            for (const [uid, user] of Object.entries(users)) {
                const groups = Array.isArray(user.groups) ? user.groups : [];
                if (groups.includes(groupId)) {
                    const newGroups = groups.filter((g) => g !== groupId);
                    updates[`approvedNumbers/${uid}/groups`] = newGroups;
                    removedLog.push(`approvedNumbers.${uid}.groups.${groupId}`);
                }
            }
            if (Object.keys(updates).length) {
                return db.ref().update(updates);
            }
        })
    );

    // 3) Execute
    await Promise.all(tasks);
    res.status(200).send({ result: 'success', log: removedLog });
    return;
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
        const newPlayerObj = { "name": utilities.shortenedName(original.name), "phoneNumber": original.phoneNumber, "firebaseId": original.firebaseId }
        console.log("adding player " + JSON.stringify(newPlayerObj) + " to " + newPlayerRef)
        admin.database().ref(newPlayerRef).set(newPlayerObj)
    })
}

const removeNullUndefined = obj => Object.entries(obj).filter(([_, v]) => v != null).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
