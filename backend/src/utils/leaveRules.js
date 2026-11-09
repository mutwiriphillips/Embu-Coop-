// Leave rules taken from the County's leave application form and the civil service regulations it quotes.
//
// The form's note: "existing civil service regulations do not allow a civil servant to carry forward
// more than half of his/her leave entitlement to the following leave year. Any leave day(s) carried
// forward in excess of fifteen (15) days will automatically be forfeited."
const DEFAULT_ENTITLEMENT = Number(process.env.LEAVE_DEFAULT_ENTITLEMENT) || 21; // working days a year; editable per person
const MAX_CARRY_DAYS = 15;
const LEAVE_TYPES = ["Annual", "Maternity", "Paternity"];

/** The most days that can be carried into the next year: half the entitlement (whole days), never above 15. */
function carryCap(entitlement) {
  return Math.min(Math.floor(Number(entitlement) / 2), MAX_CARRY_DAYS);
}

/** What happens to an unused balance at year end. */
function carryForward(balance, entitlement) {
  const b = Math.max(0, Number(balance) || 0);
  const carried = Math.min(b, carryCap(entitlement));
  return { carried, forfeited: b - carried, cap: carryCap(entitlement) };
}

const toUtcDay = (v) => {
  const d = v instanceof Date ? v : new Date(String(v).length === 10 ? v + "T00:00:00Z" : v);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const DAY = 86400000;

/** Monday to Friday days from start to end inclusive. (Public holidays are not excluded.) */
function workingDays(start, end) {
  let n = 0;
  for (let t = toUtcDay(start); t <= toUtcDay(end); t += DAY) { const dow = new Date(t).getUTCDay(); if (dow !== 0 && dow !== 6) n++; }
  return n;
}
function calendarDays(start, end) { return Math.round((toUtcDay(end) - toUtcDay(start)) / DAY) + 1; }
const daysFor = (type, start, end) => (type === "Annual" ? workingDays(start, end) : calendarDays(start, end));

module.exports = { DEFAULT_ENTITLEMENT, MAX_CARRY_DAYS, LEAVE_TYPES, carryCap, carryForward, workingDays, calendarDays, daysFor, toUtcDay };
