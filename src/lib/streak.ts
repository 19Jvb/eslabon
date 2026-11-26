// Pure streak statistics. Input days may be duplicated or unordered.
import { addDays, type Day } from "@/lib/dates";

export type HeatmapCell = { day: Day; done: boolean; future: boolean };

export function currentStreak(days: Iterable<Day>, today: Day): number {
  const marked = new Set(days);
  let cursor = marked.has(today) ? today : addDays(today, -1); // an unmarked today does not break the streak
  let count = 0;
  while (marked.has(cursor)) {
    count++;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function bestStreak(days: Iterable<Day>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  sorted.forEach((day, i) => {
    run = i > 0 && addDays(sorted[i - 1], 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

// Integer percentage of marked days in [today − (windowDays − 1), today].
export function completionRate(days: Iterable<Day>, today: Day, windowDays = 30): number {
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new RangeError("windowDays must be a positive integer");
  const start = addDays(today, -(windowDays - 1));
  const inWindow = [...new Set(days)].filter((day) => start <= day && day <= today);
  return Math.round((inWindow.length * 100) / windowDays);
}

// `weeks` columns of 7 cells, Monday to Sunday; the last column is the current week.
export function heatmapWeeks(days: Iterable<Day>, today: Day, weeks = 12): HeatmapCell[][] {
  const marked = new Set(days);
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(today, -weekday - 7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = addDays(start, w * 7 + d);
      const future = day > today;
      return { day, done: !future && marked.has(day), future };
    }),
  );
}
