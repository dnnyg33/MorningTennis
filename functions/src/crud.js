const functions = require("firebase-functions");
const admin = require("firebase-admin");
module.exports.processLateSubmission = processLateSubmission;
module.exports.createUser = createUser;
module.exports.joinGroupRequest = joinGroupRequest;
module.exports.toggleAdmin = toggleAdmin;
module.exports.approveJoinRequest = approveJoinRequest;
module.exports.modifyGroupMember = modifyGroupMember;
module.exports.deleteAccount = deleteAccount;


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
                //if found, update tokens and return
                if(body.tokens == null) {
                    res.status(200).send({ "data": serverUser });
                    return;
                }
                serverUser.tokens = body.tokens;
                admin.database().ref("approvedNumbers").child(key).update(serverUser);
                res.status(200).send({ "data": serverUser });
                return;
            }
        }
        //check invitedUsers table and add any outstanding groups
        let invitedUserSnapshot = await admin.database().ref("invitedUsers").child(body.phoneNumber).once('value', (snapshot) => {
            const invitedUser = snapshot.val();
            if (invitedUser != null) {
                console.log("invitedUser.groups: " + JSON.stringify(invitedUser.groups))
                return invitedUser
            }
        });
        let preExistingGroups = []
        if (invitedUserSnapshot.val() != null) {
            // Remove invited user entry if it exists
            admin.database().ref("invitedUsers").child(body.phoneNumber).remove()
            preExistingGroups = invitedUserSnapshot.val().groups
        }

        const newUser = {
            name: body.name,
            email: body.email ?? null,
            phoneNumber: body.phoneNumber ?? null,
            firebaseId: body.firebaseId,
            groups: preExistingGroups,
        };
        console.log("newUser: " + JSON.stringify(removeNullUndefined(newUser)))
        admin.database().ref("approvedNumbers").child(body.firebaseId).set(removeNullUndefined(newUser));
        res.status(201).send({ "data": newUser });
    })
};

function joinGroupRequest(req, res) {
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

            //find any existing, pending and delete
            admin.database().ref("joinRequests").child(body.groupId).once('value', (snapshot) => {
                const allRequests = snapshot.val();
                for (const [key, request] of Object.entries(allRequests)) {
                    if (request.userId == body.userId && request.status == "pending") {
                        admin.database().ref("joinRequests").child(body.groupId).child(key).remove()
                    }
                }
                //add new request
                admin.database().ref("joinRequests").child(body.groupId).push(request)
            });

            res.send({ "data": { "result": "pending" } })
        } else if (group.visibility == "unlisted") {
            //TODO How can this happen?
        }
    }).catch((error) => { console.error(error); res.send(500, { "data": { "result": "failure", "reason": error } }); });
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
        if (!group.admins.includes(body.adminId)) {
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

function approveJoinRequest(req, res) {
    const body = req.body.data;
    admin.database().ref("joinRequests").child(body.groupId).child(body.requestId).once('value', (snapshot) => {
        const request = snapshot.val()
        if (request == null) {
            res.send({ "data": { "result": "failure", "reason": "joinRequest not found" } })
        } else {

            admin.database().ref("groups-v2").child(body.groupId).child("admins").once('value', (snapshot) => {
                //verify that user is admin
                const admins = snapshot.val()
                if (!Object.values(admins).includes(body.adminId)) {
                    console.log(body.adminId + "not found")
                    res.sendStatus(401)
                    return;
                }
            }).then(() => {

                //change status of request to approved
                request.status = "approved"
                admin.database().ref("joinRequests").child(body.groupId).child(body.requestId).update(request)

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
                //create member_ranking for this user
                admin.database().ref("member_rankings").child(body.groupId).child(body.userId).set({ "utr": 40, "goodwill": 1 })

                //send notification to user
                admin.database().ref("approvedNumbers").child(body.userId).once('value', (snapshot) => {
                    const user = snapshot.val()
                    const message = {
                        "notification": {
                            "title": "You've been added to a group",
                            "body": "You have been added to " + body.groupName + ". Tap to view the group."
                        },
                        "token": user.tokens[0],
                    };
                    getNotificationGroup([user.userId]).then(registrationTokens => {
                        sendNotificationsToGroup(message, registrationTokens)
                    })
                })

            });
        }
    });
};

/** This method is to update an existing group members utr or goodwill. It can also be used to invite a new member to a group.
 * Phone numbers can be invited as group members before they are users. Or if a user exists, it is added directly as a group member
 * @param userPublicId - the user being invited to the group as entered by the user (only phone numbers supported). Since this value can be entered by an admin, 
 * the value is the publicId.
 * @param groupId - the group being invited to
 * @param adminId - the user who is inviting the new user
 * @param utr - the utr of the user being invited
 * @param goodwill - the goodwill of the user being invited
 */
function modifyGroupMember(req, res) {
    const body = req.body.data;
    console.log("body: " + JSON.stringify(body))
    //check that adder is admin
    admin.database().ref('groups').child(body.groupId).child("admins").once('value', (snapshot) => {
        const adminList = snapshot.val()
        if (body.adminId == undefined || body.adminId == null) {
            res.status(400).send({ "data": { "groupId": body.groupId, "userPublicId": body.userPublicId, "message": "adminId is required" } })
            return;
        }
        if (!adminList.includes(body.adminId)) {
            console.log(body.adminId + " not found")
            res.status(401).send({ "data": { "groupId": body.groupId, "userPublicId": body.userPublicId, "message": "adminId is not an admin of this group" } })
            return;
        }
        admin.database().ref("approvedNumbers").once('value', (snapshot) => {
            var users = snapshot.val()
            var foundUser = false
            for (const [key, user] of Object.entries(users)) {
                if (user.phoneNumber == body.userPublicId) {
                    console.log("Found user: " + JSON.stringify(user))
                    foundUser = true;
                    //update member_ranking for groupId
                    admin.database().ref("member_rankings").child(body.groupId).child(key).update({ "utr": body.utr, "goodwill": body.goodwill })
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
                    return;
                }
            }
            if (!foundUser) {
                var newUser = { "groups": [body.groupId], "adminId": body.adminId, "dateInvited": new Date().getTime() }
                admin.database().ref("invitedUsers").child(body.userPublicId).set(newUser)
                res.status(200).send({ "data": { "groupId": body.groupId, "userPublicId": body.userPublicId, "message": "User invited to group. Once they create an account they will be added to the group." } })
            }
        })
    })
}

function deleteAccount(req, res) {
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