import admin from "firebase-admin";

// ------------ Prototype helpers (kept as-is) ------------
Date.prototype.addDays = function (d) {
    return new Date(this.valueOf() + 864e5 * d);
};

Array.prototype.sortBy = function (callback) {
    return this.sort((a, b) => callback(b) - callback(a));
};

Array.prototype.sum = function () {
    return this.reduce((a, b) => a + b);
};

Array.prototype.avg = function () {
    return this.sum() / this.length;
};

// ------------ Local helpers ------------
const removeNullUndefined = (obj) =>
    Object.entries(obj)
        .filter(([_, v]) => v != null)
        .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// ------------ Exports ------------
export function createNewWeekDbPath(weekStartDay) {
    const startDayInt = dayOfWeekAsInteger(weekStartDay);
    const now = new Date();
    const diff = ((startDayInt + 7) - now.getDay()) % 7;
    const startDate = now.addDays(diff);
    const path = weekStartDay + fmt(startDate, "-M-D-YYYY");
    return path;
}

/**
 * @method dayOfWeekAsInteger
 * @param {String} day
 * @return {Number} Returns day as number
 */
export function dayOfWeekAsInteger(day) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(day);
}

export function shortenedName(name) {
    const parts = name.split(" ");
    switch (parts.length) {
        case 1:
            return name;
        case 2:
            return `${parts[0]} ${parts[1].substring(0, 1)}.`;
        case 3:
            return `${parts[0]} ${parts[1].substring(0, 1)} ${parts[2]}`;
        default:
            return name;
    }
}

export function removeDuplicates(data) {
    const firebaseId = [];
    let uniquePlayers = [];
    for (const [, item] of Object.entries(data)) {
        const cleanNumber = item.firebaseId;
        if (firebaseId.includes(cleanNumber)) {
            console.log("duplicate entry for: " + cleanNumber);
            uniquePlayers = uniquePlayers.filter((f) => cleanNumber !== f.firebaseId);
        }
        item.scheduledDays = 0;
        firebaseId.push(cleanNumber);
        uniquePlayers.push(item);
    }
    return uniquePlayers;
}

// todo: remove once app versions are above 28
export function removeEmptyDays(result) {
    const v5Result = {};
    for (const [key, value] of Object.entries(result)) {
        if (value != 0) {
            v5Result[key] = value;
        }
    }
    return v5Result;
}

export function fmt(date, format = "YYYY-MM-DDThh:mm:ss") {
    const pad2 = (n) => n.toString().padStart(2, "0");

    const map = {
        YYYY: date.getFullYear(),
        MM: pad2(date.getMonth() + 1),
        DD: pad2(date.getDate()),
        hh: pad2(date.getHours()),
        mm: pad2(date.getMinutes()),
        ss: pad2(date.getSeconds()),
        M: date.getMonth() + 1,
        D: date.getDate(),
    };

    return Object.entries(map).reduce((prev, entry) => prev.replace(...entry), format);
}

export function buildDynamicDaysMap(groupId) {
    return admin
        .database()
        .ref("groups-v2")
        .child(groupId)
        .child("meetups2")
        .get()
        .then((snapshot) => {
            let daysMap = {};
            if (snapshot.exists()) {
                const meetups = snapshot.val();
                meetups.forEach((meetup) => {
                    const key =
                        meetup.time == null
                            ? capitalizeFirstLetter(meetup.dayOfWeek)
                            : `${capitalizeFirstLetter(meetup.dayOfWeek)} ${meetup.time}`;
                    daysMap[key.trim()] = 0;
                });
            } else {
                console.log("No data available");
                daysMap = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0 };
            }
            return daysMap;
        });
}

export async function sanitizeUserIdToFirebaseId(id) {
    if (id.length > 10) {
        return id;
    }
    console.log("Found publicId: " + id + ", looking up firebaseId");
    const snapshot = await admin.database().ref("approvedNumbers").once("value");

    const users = snapshot.val();
    for (const [key, user] of Object.entries(users)) {
        if (user.phoneNumber == id) {
            console.log("Converted adminId " + id + "to firebaseId " + key);
            return key;
        }
    }
    console.log("No firebaseId found for adminId: " + id);
    return null;
}

export function removeByValue(originalMap, valueToRemove) {
    return Object.entries(originalMap)
        .filter(([_, value]) => value !== valueToRemove)
        .reduce((obj, [key, value]) => ((obj[key] = value), obj), {});
}

// Optionally export the helper if you end up using it elsewhere:
// export { removeNullUndefined };
