// A calendar day as 'YYYY-MM-DD', with no time or zone attached.
export type Day = string;

const DEFAULT_TIME_ZONE = "Europe/Madrid";
const DAY_MS = 86_400_000;
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
// A Day at UTC midnight read in UTC gives its calendar weekday, whatever the user's zone or DST.
const WEEKDAY = new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: "UTC" });
const WEEKDAY_INITIAL = new Intl.DateTimeFormat("es-ES", { weekday: "narrow", timeZone: "UTC" });

// The user's local date in an IANA zone. The server runs in UTC, so this is the only source of "today".
export function todayIn(timeZone: string, now: Date = new Date()): Day {
  try {
    return formatDay(timeZone, now);
  } catch {
    return formatDay(DEFAULT_TIME_ZONE, now);
  }
}

// Pure UTC arithmetic: daylight saving changes cannot shift the result.
// It does not validate ("2026-02-30" silently becomes 2026-03-02): check days from the client with isEditableDay first.
export function addDays(day: Day, n: number): Day {
  return toDay(toUtcMs(day) + n * DAY_MS);
}

export function isValidDay(s: string): boolean {
  return DAY_FORMAT.test(s) && toDay(toUtcMs(s)) === s;
}

// Marks can be edited for today and the 6 previous days, never for the future.
export function isEditableDay(day: Day, today: Day): boolean {
  return isValidDay(day) && isValidDay(today) && addDays(today, -6) <= day && day <= today;
}

// The editable days, oldest first: today−6 … today.
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
