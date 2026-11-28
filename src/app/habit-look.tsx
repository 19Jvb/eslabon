import type { Ref } from "react";
import { focusRing } from "@/app/ui";
import { habitColor } from "@/lib/habits";
import { bestStreak, completionRate, currentStreak, todayNudge } from "@/lib/streak";

// The look of a habit card, shared by /app and the landing preview so both draw the same chain, stats and heatmap.

// Empty and future cells are outlined in neutral-500: 3:1 or more on white (WCAG 1.4.11).
export const cellClass = (done: boolean, future: boolean, color: string) =>
  `size-3 rounded-[3px] border ${future ? "border-dashed border-neutral-500" : done ? habitColor(color).done : "border-neutral-500"}`;

// The gap between two days. Between two marked ones it is the chain: filled in their 700 at their full height,
// and with the corners they share squared (joinedCorners) both days read as one band, even with the 3 px gaps of
// a phone. The gaps grow to fill a phone and stay at 8 px above. No transition: the chain changes at once.
export function ChainLink({ linked, color }: { linked: boolean; color: string }) {
  return (
    <span
      aria-hidden="true"
      data-link={linked || undefined}
      className={`flex-1 self-stretch sm:w-2 sm:flex-none ${linked ? habitColor(color).link : ""}`}
    />
  );
}

// The corners a day shares with a linked neighbour on its left or right.
export const joinedCorners = (left: boolean, right: boolean) =>
  `${left ? "rounded-l-none" : ""} ${right ? "rounded-r-none" : ""}`;

// A day button of the chain (the card's week and the history calendar): filled in the habit's 700 while pressed,
// today outlined in black and its corners squared where it joins a neighbour.
export const dayButtonClass = (isToday: boolean, left: boolean, right: boolean, color: string) =>
  `flex size-11 shrink-0 flex-col items-center justify-center rounded-lg text-neutral-700 hover:bg-neutral-100 aria-pressed:text-white motion-safe:transition-[color,background-color,border-color,scale] motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.97] ${isToday ? "border-2 border-neutral-900" : "border border-neutral-500"} ${joinedCorners(left, right)} ${habitColor(color).pressed} ${focusRing}`;

export const dayCount = (n: number) => (n === 1 ? "1 día" : `${n} días`);

// The stats and, while today is unmarked, the nudge below them: outside the <dl>, so its values stay as they are.
// The current streak leads: display face, larger and in the habit's 700.
export function HabitStats({
  marked,
  today,
  color,
  streakRef,
}: {
  marked: string[];
  today: string;
  color: string;
  streakRef?: Ref<HTMLElement>;
}) {
  const streak = currentStreak(marked, today);
  const nudge = todayNudge(streak, marked.includes(today));
  const stats = [
    ["Racha actual", dayCount(streak)],
    ["Mejor racha", dayCount(bestStreak(marked))],
    ["Últimos 30 días", `${completionRate(marked, today)} %`],
  ];

  return (
    <>
      <dl className="grid grid-cols-3 gap-2 sm:gap-4">
        {stats.map(([term, value], i) => (
          <div key={term}>
            <dt className="text-xs text-neutral-600">{term}</dt>
            {i === 0 ? (
              <dd
                ref={streakRef}
                className={`origin-left font-display text-2xl leading-tight font-semibold tabular-nums ${habitColor(color).streak}`}
              >
                {value}
              </dd>
            ) : (
              <dd className="font-semibold text-neutral-900 tabular-nums">{value}</dd>
            )}
          </div>
        ))}
      </dl>
      {nudge && <p className="text-sm text-neutral-600">{nudge}</p>}
    </>
  );
}

// Monday, Wednesday and Friday name the heatmap rows, as in a calendar.
const rowLabels = ["L", "", "X", "", "V", "", ""];

export function HeatmapRowLabels() {
  return (
    <div aria-hidden="true" className="grid grid-rows-7 gap-[3px] text-[10px] leading-3 text-neutral-600">
      {rowLabels.map((label, i) => (
        <span key={i}>{label}</span>
      ))}
    </div>
  );
}
