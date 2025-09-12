
// utilities you already export
module.exports.dayOfWeekAsInteger = dayOfWeekAsInteger;
module.exports.shortenedName = shortenedName;
module.exports.removeDuplicates = removeDuplicates;
module.exports.removeEmptyDays = removeEmptyDays;
module.exports.buildDynamicDaysMap = buildDynamicDaysMap;
module.exports.fmt = fmt;


Date.prototype.addDays = function (d) { return new Date(this.valueOf() + 864E5 * d); };
function createNewWeekDbPath(weekStartDay) {
    let startDayInt = dayOfWeekAsInteger(weekStartDay); //5
    let now = new Date();
    // now.setDate(now.getDate()-5)//for testing only
    let diff = ((startDayInt + 7) - now.getDay()) % 7; //5
    let startDate = now.addDays(diff);
    let path = weekStartDay + fmt(startDate, "-M-D-YYYY");
    return path;
}

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

const removeNullUndefined = obj => Object.entries(obj).filter(([_, v]) => v != null).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});


function shortenedName(name) {
    var parts = name.split(" ");
    switch (parts.length) {
        case 1:
            return this;
        case 2:
            return `${parts[0]} ${parts[1].substring(0, 1)}.`;
        case 3:
            return `${parts[0]} ${parts[1].substring(0, 1)} ${parts[2]}`;
    }
}

function removeDuplicates(data) {
    var firebaseId = []
    var uniquePlayers = []
    //iterate through data 
    for (const [key, item] of Object.entries(data)) {
        let cleanNumber = item.firebaseId
        if (firebaseId.includes(cleanNumber)) {
            console.log("duplicate entry for: " + cleanNumber)
            uniquePlayers = uniquePlayers.filter(f => cleanNumber !== f.firebaseId)
        }
        item.scheduledDays = 0
        firebaseId.push(cleanNumber)
        uniquePlayers.push(item)


    }
    return uniquePlayers
}

//todo: this function can be removed once app versions are above 28
function removeEmptyDays(result) {
    //remove days where value is 0
    const v5Result = {}
    for (const [key, value] of Object.entries(result)) {
        if (value != 0) {
            v5Result[key] = value
        }
    }
    return v5Result;
}

function fmt(date, format = 'YYYY-MM-DDThh:mm:ss') {
    const pad2 = (n) => n.toString().padStart(2, '0');

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

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}


function buildDynamicDaysMap(groupId) {
    return admin.database().ref("groups-v2").child(groupId).child("meetups2").get().then((snapshot) => {
        if (snapshot.exists()) {
            daysMap = {};
            let meetups = snapshot.val();
            meetups.forEach(meetup => {
                let key = ""
                if (meetup.time == null) {
                    key = capitalizeFirstLetter(meetup.dayOfWeek);
                } else {
                    key = capitalizeFirstLetter(meetup.dayOfWeek) + " " + meetup.time;
                }
                daysMap[key.trim()] = 0;
            });
        } else {
            console.log("No data available");
            let daysMap = { "Monday": 0, "Tuesday": 0, "Wednesday": 0, "Thursday": 0, "Friday": 0 }
        }
        return daysMap;
    });
}