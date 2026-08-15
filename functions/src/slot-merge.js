/**Availability as the app meant to send it.
 *
 * Slots are painted one hour at a time, so a member free from 7 to 10 sends
 * three touching pieces. The board is keyed by slot label, so left as they are
 * each piece becomes its own grouping and one three hour window shows up as
 * three one hour ones. Merging on the way into the sort puts them back
 * together.
 *
 * What merges with what is decided by a slot's `date`. A member can sign up
 * for weeks ahead, and each week's signup lands in its own node, so within a
 * node a date is normally one particular day — but a slot from a client older
 * than dated slots carries only a weekday, and two of those from different
 * weeks would otherwise read as one day's availability twice over. Undated
 * slots are therefore dated from the week node they were written into, which
 * is the week they were submitted for by definition.
 *
 * Anything this can't read — no day at all, times not in the "h.mm" form they
 * are stored in — is passed through untouched rather than dropped, so a row it
 * doesn't understand can never quietly delete availability somebody submitted.
 */

const MINUTES_IN_DAY = 24 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DAY_ORDER = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 7,
};

module.exports.mergeSlots = mergeSlots;
module.exports.normalizeSubmissions = normalizeSubmissions;
module.exports.weekStartOf = weekStartOf;
module.exports.dateOfSlot = dateOfSlot;

/**Every player in [players] with their availableSlots merged. [weekName] is
 * the node they were read from ("Monday-8-11-2025"), used to date any slot
 * that arrived without a date.
 *
 * The players themselves are copied rather than edited, so callers holding the
 * incoming submissions — the notification pass runs off the same read — still
 * see exactly what the member sent. */
function normalizeSubmissions(players, weekName) {
    const weekStart = weekStartOf(weekName);
    return Object.values(players || {}).map((player) => {
        if (player == null || player.availableSlots == undefined) return player;
        return Object.assign({}, player, {
            availableSlots: mergeSlots(player.availableSlots, weekStart),
        });
    });
}

/**The slots in [slots] with everything touching or overlapping on one day
 * collapsed into a single span, in date then time order. [weekStart] dates the
 * slots that came in without a date, and may be null when the week can't be
 * read — those slots then group by weekday alone, which is what this did
 * before slots were dated. */
function mergeSlots(slots, weekStart) {
    const readable = [];
    const unreadable = [];
    //written as a list, but firebase hands back a map when keys are sparse
    for (const slot of Object.values(slots || {})) {
        if (slot == null) continue;
        const start = minutesOf(slot.startTime);
        let end = minutesOf(slot.endTime);
        if (slot.dayOfWeek == null || start == null || end == null) {
            unreadable.push(slot);
            continue;
        }
        //a span reaching midnight is stored as 0:00: it closes the day rather
        //than ending before it began
        if (end <= start) end += MINUTES_IN_DAY;
        const day = String(slot.dayOfWeek);
        readable.push({
            day: day,
            date: dateOf(slot.date) || dateOnWeek(weekStart, day),
            start: start,
            end: end,
        });
    }

    readable.sort((a, b) =>
        compareDates(a, b) || dayOrder(a.day) - dayOrder(b.day) ||
        a.start - b.start);

    const merged = [];
    for (const span of readable) {
        const open = merged[merged.length - 1];
        if (open != null && sameDay(open, span) && span.start <= open.end) {
            if (span.end > open.end) open.end = span.end;
            continue;
        }
        merged.push(Object.assign({}, span));
    }

    return merged.map(asSlot).concat(unreadable);
}

/**Two spans are the same day when they are on the same date, or — for slots
 * with no date to place them — the same weekday. */
function sameDay(a, b) {
    if (a.date != null && b.date != null) return a.date === b.date;
    if (a.date != null || b.date != null) return false;
    return a.day === b.day;
}

function compareDates(a, b) {
    if (a.date == null && b.date == null) return 0;
    if (a.date == null) return 1;
    if (b.date == null) return -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

function asSlot(span) {
    const slot = {
        dayOfWeek: span.day,
        startTime: storedTime(span.start),
        endTime: storedTime(span.end),
        label: labelFor(span.day, span.start, span.end),
    };
    if (span.date != null) slot.date = span.date;
    return slot;
}

/**The day [slot] is for, "2025-08-11": its own date when it carries one, and
 * otherwise the day its weekday falls on in the week starting [weekStart] —
 * the same reading `mergeSlots` groups by. Null when neither can be read. */
function dateOfSlot(slot, weekStart) {
    if (slot == null) return null;
    return dateOf(slot.date) || dateOnWeek(weekStart, String(slot.dayOfWeek));
}

/**A slot's stored date, "2025-08-11", or null if it hasn't got a usable one. */
function dateOf(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    return text;
}

/**The date [day] falls on in the week starting [weekStart], for slots that
 * arrived without one. Null when the week itself couldn't be read. */
function dateOnWeek(weekStart, day) {
    if (weekStart == null) return null;
    const dayNumber = DAY_ORDER[day];
    if (dayNumber == undefined) return null;
    const startNumber = weekStart.getUTCDay() || 7;
    const offset = (dayNumber - startNumber + 7) % 7;
    return isoDate(new Date(weekStart.getTime() + offset * MS_PER_DAY));
}

/**The first day of the week a node is named for. Names are built by the app
 * and the functions alike as "<PlayStartDay>-M-D-YYYY", with no padding. */
function weekStartOf(weekName) {
    if (weekName == null) return null;
    const parts = String(weekName).split("-");
    if (parts.length !== 4) return null;
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    const year = parseInt(parts[3], 10);
    if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    //a name carrying a day its month hasn't got would otherwise roll over
    //into the next one and date every slot in the week a day out
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }
    return date;
}

function isoDate(date) {
    return date.getUTCFullYear() + "-" +
        pad(date.getUTCMonth() + 1) + "-" +
        pad(date.getUTCDate());
}

/**Days sort in week order; anything unrecognised sorts last but still groups
 * with itself, so an unknown day can't merge into a known one. */
function dayOrder(day) {
    return DAY_ORDER[day] == undefined ? 99 : DAY_ORDER[day];
}

/**Times are stored as "h.mm" strings, so "8.45" is 8:45 and not a fraction of
 * an hour. */
function minutesOf(time) {
    if (time == null) return null;
    const [hours, minutes] = String(time).split(".");
    const hour = parseInt(hours, 10);
    if (isNaN(hour)) return null;
    return hour * 60 + (parseInt(minutes, 10) || 0);
}

function storedTime(minutes) {
    const wrapped = minutes % MINUTES_IN_DAY;
    return Math.floor(wrapped / 60) + "." + pad(wrapped % 60);
}

/**The label the app builds, since that is the key the board is grouped under:
 * "Monday 7:00-10:00". */
function labelFor(day, start, end) {
    return dayLabel(day) + " " + clock(start) + "-" + clock(end);
}

function dayLabel(day) {
    return day.charAt(0).toUpperCase() + day.slice(1);
}

function clock(minutes) {
    const wrapped = minutes % MINUTES_IN_DAY;
    return Math.floor(wrapped / 60) + ":" + pad(wrapped % 60);
}

function pad(minutes) {
    return String(minutes).padStart(2, "0");
}
