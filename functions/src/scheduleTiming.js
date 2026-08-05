/**
 * Per-group signup timing.
 *
 * A group stores when its signups should open and close under
 * `groups-v2/<groupId>/scheduleTimePreferences` (written by the app's
 * "Configure schedule reset" screen, plus the close editor that sits with the
 * available days):
 *
 *   { signupOpenDay: "Friday", signupOpenTime: "8:00 AM",
 *     signupCloseDay: "Sunday", signupCloseTime: "8:00 PM",
 *     playStartDay: "Monday", timeZone: "America/Denver" }
 *
 * The open moment is the group's *reset*: it ends the old week, creates the
 * empty week the app writes signups into, and reopens signups. Days and times
 * are display strings carrying no zone of their own, so they are read in the
 * group's `timeZone` — DEFAULT_TIMEZONE below, the zone the crons have always
 * used, for any group that has never saved one.
 *
 * A tick runs every TICK_MINUTES and asks, for each group, "did this moment
 * pass since we last acted on it?". Firing is keyed off the scheduled moment
 * itself (stored in `scheduleAutomation`), not off the tick, so a late or
 * retried tick still fires exactly once and a manual open/close by an admin is
 * never undone by the next tick.
 */

const DEFAULT_TIMEZONE = "America/Denver";

module.exports.DEFAULT_TIMEZONE = DEFAULT_TIMEZONE;
module.exports.TICK_MINUTES = 15;
module.exports.DEFAULT_PREFERENCES = defaultPreferences();
module.exports.defaultPreferences = defaultPreferences;
module.exports.preferencesFor = preferencesFor;
module.exports.timeZoneOf = timeZoneOf;
module.exports.signupsCanClose = signupsCanClose;
module.exports.zonedNow = zonedNow;
module.exports.zonedWallClockDate = zonedWallClockDate;
module.exports.weekReferenceDate = weekReferenceDate;
module.exports.weekMinuteOf = weekMinuteOf;
module.exports.dueEvents = dueEvents;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MINUTES_PER_WEEK = 7 * 24 * 60;
const MS_PER_MINUTE = 60 * 1000;

/** How late a tick may still act on a scheduled moment. */
const CATCHUP_MINUTES = {
    // A missed open would cost the group its whole signup window, and a missed
    // close would leave signups open all week, so both are worth firing late.
    open: 120,
    close: 120,
    // A "closing soon" warning that lands after the close is just confusing.
    closingWarning: 20,
};

/** How far ahead of the close the "signups are closing" warning goes out. */
const CLOSING_WARNING_LEAD_MINUTES = 60;

function defaultPreferences() {
    return {
        signupOpenDay: "Friday",
        signupOpenTime: "8:00 AM",
        signupCloseDay: "Sunday",
        signupCloseTime: "8:00 PM",
        playStartDay: "Monday",
        timeZone: DEFAULT_TIMEZONE,
    };
}

/**
 * Falls back field by field, so a partial or malformed record still leaves the
 * group on a working schedule rather than one that never fires.
 */
function preferencesFor(groupData) {
    const stored = (groupData && groupData.scheduleTimePreferences) || {};
    const merged = defaultPreferences();
    for (const key of Object.keys(merged)) {
        const value = typeof stored[key] === "string" ? stored[key].trim() : "";
        if (value === "") continue;
        if (key === "timeZone") {
            if (isUsableTimeZone(value)) merged[key] = value;
            else console.warn("ignoring unusable timeZone '" + value + "', using " + merged[key]);
            continue;
        }
        const usable = key.endsWith("Time") ? parseTimeOfDay(value) !== null : isDayName(value);
        if (usable) {
            merged[key] = key.endsWith("Time") ? value : capitalize(value);
        } else {
            console.warn("ignoring unusable " + key + " '" + value + "', using " + merged[key]);
        }
    }
    return merged;
}

function isDayName(value) {
    return DAYS.indexOf(capitalize(String(value).trim())) >= 0;
}

/** Intl is the only zone database here, so a zone is usable if it accepts it. */
function isUsableTimeZone(value) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Whether a group's signups ever close. "When is good" groups take late
 * signups all week, so they only ever reset — they are left permanently open,
 * which means `scheduleIsOpen` carries no information about them and must not
 * be read as one.
 */
function signupsCanClose(groupData) {
    return (groupData && groupData.sortingAlgorithm) !== "whenIsGood";
}

/** The zone a group's stored day/time strings are read in. */
function timeZoneOf(groupData) {
    return preferencesFor(groupData).timeZone;
}

/** Monday 1 .. Sunday 7, matching Dart's DateTime.weekday. */
function isoDayOf(dayName) {
    const index = DAYS.indexOf(capitalize(String(dayName || "").trim()));
    if (index < 0) return null;
    return index === 0 ? 7 : index;
}

/**
 * Where `date` falls in the week according to `timeZone`, plus the epoch ms of
 * the minute it lands in. Timezone offsets are whole minutes, so truncating the
 * epoch to the minute is the same instant in any zone.
 */
function zonedNow(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const lookup = {};
    for (const part of parts) lookup[part.type] = part.value;

    const dayIndex = DAYS.indexOf(lookup.weekday);
    const hour = parseInt(lookup.hour, 10);
    const minute = parseInt(lookup.minute, 10);
    return {
        weekday: lookup.weekday,
        weekMinute: dayIndex * 24 * 60 + hour * 60 + minute,
        minuteTs: date.getTime() - (date.getTime() % MS_PER_MINUTE),
    };
}

/**
 * The play week the app considers current at `date` for a group on
 * `preferences`, as a Date whose *local* calendar fields are that week's start
 * day (pinned to noon so day arithmetic can't be dragged over a boundary by
 * DST).
 *
 * This mirrors `weekStartTime` in the app (util/util.dart): the week rolls over
 * at the group's reset moment. The app writes signups to the path it derives
 * itself, so the empty-week marker has to land on the same node — the two sides
 * have to read the reset identically or they end up a week apart.
 */
function weekReferenceDate(date, preferences) {
    const prefs = preferences || defaultPreferences();
    const resetDay = isoDayOf(prefs.signupOpenDay) || 5;
    const playStartDay = isoDayOf(prefs.playStartDay) || 1;
    const resetTime = parseTimeOfDay(prefs.signupOpenTime) || { hour: 8, minute: 0 };

    // Rolling the clock back by the reset time puts the turnover at midnight,
    // so the day arithmetic below is all that's left to do.
    const p = zonedParts(date, prefs.timeZone || DEFAULT_TIMEZONE);
    const sinceReset =
        Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) -
        (resetTime.hour * 60 + resetTime.minute) * MS_PER_MINUTE;

    const isoDay = new Date(sinceReset).getUTCDay() || 7; // Monday 1 .. Sunday 7
    const daysBackToReset = (isoDay - resetDay + 7) % 7;
    // A reset landing on the play start day itself opens the following week
    // rather than the one already under way.
    let daysToPlayStart = (playStartDay - resetDay + 7) % 7;
    if (daysToPlayStart === 0) daysToPlayStart = 7;

    const weekStart = new Date(
        sinceReset + (daysToPlayStart - daysBackToReset) * 24 * 60 * MS_PER_MINUTE,
    );
    return new Date(
        weekStart.getUTCFullYear(),
        weekStart.getUTCMonth(),
        weekStart.getUTCDate(),
        12,
    );
}

/**
 * A Date whose *local* calendar fields are `timeZone`'s wall clock today,
 * pinned to noon. For callers that read `getDay()`/`getDate()` and need the
 * group's calendar day rather than the container's UTC one.
 */
function zonedWallClockDate(date, timeZone) {
    const p = zonedParts(date, timeZone);
    return new Date(p.year, p.month - 1, p.day, 12);
}

function zonedParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const lookup = {};
    for (const part of parts) lookup[part.type] = part.value;
    return {
        year: parseInt(lookup.year, 10),
        month: parseInt(lookup.month, 10),
        day: parseInt(lookup.day, 10),
        hour: parseInt(lookup.hour, 10),
        minute: parseInt(lookup.minute, 10),
    };
}

/** Minutes from Sunday 00:00, or null when the stored strings are unusable. */
function weekMinuteOf(dayName, timeString) {
    const dayIndex = DAYS.indexOf(capitalize(String(dayName || "").trim()));
    const time = parseTimeOfDay(timeString);
    if (dayIndex < 0 || time === null) return null;
    return dayIndex * 24 * 60 + time.hour * 60 + time.minute;
}

/** Accepts "8:00 AM" (what the app writes) and "20:00". */
function parseTimeOfDay(timeString) {
    const value = String(timeString || "").trim();
    const twelveHour = value.match(/^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?$/);
    if (twelveHour) {
        let hour = parseInt(twelveHour[1], 10);
        const minute = parseInt(twelveHour[2], 10);
        const isPm = twelveHour[3].toLowerCase() === "p";
        if (hour < 1 || hour > 12 || minute > 59) return null;
        if (hour === 12) hour = 0;
        return { hour: isPm ? hour + 12 : hour, minute };
    }
    const twentyFourHour = value.match(/^(\d{1,2}):(\d{2})$/);
    if (twentyFourHour) {
        const hour = parseInt(twentyFourHour[1], 10);
        const minute = parseInt(twentyFourHour[2], 10);
        if (hour > 23 || minute > 59) return null;
        return { hour, minute };
    }
    return null;
}

function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
}

/**
 * The most recent occurrence of a weekly moment, as {minutesAgo, targetTs}.
 */
function lastOccurrence(now, weekMinute) {
    let minutesAgo = now.weekMinute - weekMinute;
    if (minutesAgo < 0) minutesAgo += MINUTES_PER_WEEK;
    return { minutesAgo, targetTs: now.minuteTs - minutesAgo * MS_PER_MINUTE };
}

function isDue(now, weekMinute, catchupMinutes, lastHandledTs) {
    if (weekMinute === null) return null;
    const occurrence = lastOccurrence(now, weekMinute);
    if (occurrence.minutesAgo > catchupMinutes) return null;
    if ((lastHandledTs || 0) >= occurrence.targetTs) return null;
    return occurrence.targetTs;
}

/**
 * What this group is owed at `now`. Each value is the epoch ms of the scheduled
 * moment being acted on — write it back to `scheduleAutomation` after the work
 * succeeds so the next tick doesn't repeat it. Null means nothing is due.
 *
 * @param {Object} groupData raw `groups-v2/<groupId>` value
 * @param {Date} date now
 */
function dueEvents(groupData, date) {
    const preferences = preferencesFor(groupData);
    const automation = (groupData && groupData.scheduleAutomation) || {};
    const now = zonedNow(date, preferences.timeZone);

    const openMinute = weekMinuteOf(preferences.signupOpenDay, preferences.signupOpenTime);
    const storedCloseMinute = weekMinuteOf(preferences.signupCloseDay, preferences.signupCloseTime);
    // A close sitting on the reset would open the week and shut it again in the
    // same tick, leaving the group permanently closed. The app blocks saving
    // one, so this only catches a record that predates that or was hand-edited.
    const closeMinute = storedCloseMinute === openMinute ? null : storedCloseMinute;
    if (closeMinute === null && storedCloseMinute !== null) {
        console.warn("ignoring close that coincides with the reset for " + preferences.signupOpenDay);
    }
    const warningMinute =
        closeMinute === null
            ? null
            : (closeMinute - CLOSING_WARNING_LEAD_MINUTES + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;

    return {
        preferences,
        openAt: isDue(now, openMinute, CATCHUP_MINUTES.open, automation.lastOpenedAt),
        closeAt: isDue(now, closeMinute, CATCHUP_MINUTES.close, automation.lastClosedAt),
        closingWarningAt: isDue(
            now,
            warningMinute,
            CATCHUP_MINUTES.closingWarning,
            automation.lastClosingWarningAt,
        ),
    };
}
