// A calendar day as 'YYYY-MM-DD', with no time or zone attached.
export type Day = string;

const DEFAULT_TIME_ZONE = "Europe/Madrid";
const DAY_MS = 86_400_000;
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
// A Day at UTC midnight read in UTC gives its calendar weekday, whatever the user's zone or DST.
const WEEKDAY = new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: "UTC" });
const WEEKDAY_INITIAL = new Intl.DateTimeFormat("es-ES", { weekday: "narrow", timeZone: "UTC" });
const MONTH_NAME = new Intl.DateTimeFormat("es-ES", { month: "long", timeZone: "UTC" });
const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

// The user's local date in an IANA zone. The server runs in UTC, so this is the only source of "today".
export function todayIn(timeZone: string, now: Date = new Date()): Day {
  return formatDay(timeZoneOrDefault(timeZone), now);
}

// The zone itself if Intl knows it; Europe/Madrid when it is missing or not a valid zone, never the server's UTC.
export function timeZoneOrDefault(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

// «27 de noviembre de 2026»: the calendar date of an instant (a timestamptz) in the user's zone.
export function longDateIn(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: timeZoneOrDefault(timeZone) }).format(new Date(at));
}

// Pure UTC arithmetic: daylight saving changes cannot shift the result.
// It does not validate ("2026-02-30" silently becomes 2026-03-02): check days from the client with isEditableDay first.
export function addDays(day: Day, n: number): Day {
  return toDay(toUtcMs(day) + n * DAY_MS);
}

export function isValidDay(s: string): boolean {
  return DAY_FORMAT.test(s) && toDay(toUtcMs(s)) === s;
}

// The oldest day that can be marked; the check_ins insert policy uses the same date.
export const EARLIEST_DAY: Day = "2000-01-01";
export const EARLIEST_MONTH = EARLIEST_DAY.slice(0, 7);

// Marks can be edited for any day from EARLIEST_DAY to today, never for the future.
// Valid 'YYYY-MM-DD' strings compare in calendar order.
export function isEditableDay(day: Day, today: Day): boolean {
  return isValidDay(day) && isValidDay(today) && EARLIEST_DAY <= day && day <= today;
}

// The 7 days shown on the habit card, oldest first: today−6 … today.
export function lastWeek(today: Day): Day[] {
  return Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
}

// «Hoy», «Ayer» or «Lunes 23» for screen readers, plus the initial and number shown on the button.
export function dayNames(day: Day, today: Day): { label: string; initial: string; date: number } {
  const at = new Date(toUtcMs(day));
  const date = at.getUTCDate();
  const weekday = WEEKDAY.format(at);
  const label =
    day === today ? "Hoy" : day === addDays(today, -1) ? "Ayer" : `${weekday[0].toUpperCase()}${weekday.slice(1)} ${date}`;
  return { label, initial: WEEKDAY_INITIAL.format(at), date };
}

// A calendar month as 'YYYY-MM'. ?mes= of the history page: a month from January 2000 to the user's month, or else
// the user's month. Valid 'YYYY-MM' strings compare in calendar order.
export function shownMonth(param: string | undefined, today: Day): string {
  const current = today.slice(0, 7);
  return param && MONTH_FORMAT.test(param) && EARLIEST_MONTH <= param && param <= current ? param : current;
}

export function addMonths(month: string, n: number): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// The month's weeks, Monday to Sunday, with null for the days of the neighbouring months.
export function monthWeeks(month: string): (Day | null)[][] {
  const first = `${month}-01`;
  const lead = (new Date(toUtcMs(first)).getUTCDay() + 6) % 7;
  const days: (Day | null)[] = Array(lead).fill(null);
  for (let day = first; day.startsWith(month); day = addDays(day, 1)) days.push(day);
  while (days.length % 7) days.push(null);
  return Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
}

// «Noviembre de 2026».
export function monthTitle(month: string): string {
  const name = MONTH_NAME.format(new Date(toUtcMs(`${month}-01`)));
  return `${name[0].toUpperCase()}${name.slice(1)} de ${month.slice(0, 4)}`;
}

// «3 de noviembre».
export function dayInMonthName(day: Day): string {
  const at = new Date(toUtcMs(day));
  return `${at.getUTCDate()} de ${MONTH_NAME.format(at)}`;
}

function formatDay(timeZone: string, now: Date): Day {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toUtcMs(day: Day): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

function toDay(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10);
}
