"use client";

import Link from "next/link";
import { Fragment, type ReactNode, useId } from "react";
import { ChainLink, dayButtonClass, HabitStats } from "@/app/habit-look";
import { secondaryButton } from "@/app/ui";
import { type Day, dayInMonthName, WEEKDAY_LETTERS } from "@/lib/dates";
import { HABIT_GONE } from "@/lib/habits";
import { ErrorMessage, type Habit, useCheckIns } from "../../habit-forms";

// The habit's stats and its month, Monday to Sunday: each day up to today is a toggle, like the card's week, and
// marked days of the same week join into one chain. The headers row has the same gaps as the weeks, so each letter
// sits over its column.
export function HabitHistory({
  habit,
  marked,
  today,
  weeks,
  heading,
  children,
}: {
  habit: Habit;
  marked: Day[];
  today: Day;
  weeks: (Day | null)[][];
  heading: ReactNode;
  children: ReactNode;
}) {
  const { shown, toggle, error, announcement, streakRef } = useCheckIns(habit, marked, today);
  const id = useId();
  const isOn = (day: Day | null) => day !== null && day <= today && shown.includes(day);

  return (
    <>
      <div className="flex flex-col gap-3">
        {heading}
        <HabitStats marked={shown} today={today} color={habit.color} streakRef={streakRef} />
      </div>
      <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-3 sm:p-4">
        {children}
        <div className="flex flex-col gap-2 sm:w-fit">
          <div aria-hidden="true" className="flex">
            {WEEKDAY_LETTERS.map((letter, i) => (
              <Fragment key={letter}>
                {i > 0 && <ChainLink linked={false} color={habit.color} />}
                <span className="w-11 shrink-0 text-center text-xs font-semibold text-neutral-600">{letter}</span>
              </Fragment>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week.find((day) => day !== null)} className="flex items-center">
              {week.map((day, i) => {
                const left = i > 0 && isOn(day) && isOn(week[i - 1]);
                const right = i < week.length - 1 && isOn(day) && isOn(week[i + 1]);
                return (
                  <Fragment key={i}>
                    {i > 0 && <ChainLink linked={left} color={habit.color} />}
                    {day === null ? (
                      <span className="size-11 shrink-0" />
                    ) : day > today ? (
                      <span
                        aria-hidden="true"
                        className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-neutral-400 text-sm text-neutral-600 tabular-nums"
                      >
                        {Number(day.slice(8))}
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-pressed={shown.includes(day)}
                        aria-label={`${dayInMonthName(day)}${day === today ? ", hoy" : ""}`}
                        onClick={() => toggle(day)}
                        className={`${dayButtonClass(day === today, left, right, habit.color)} text-sm font-semibold tabular-nums`}
                      >
                        {Number(day.slice(8))}
                      </button>
                    )}
                  </Fragment>
                );
              })}
            </div>
          ))}
        </div>
        <ErrorMessage id={`${id}-error`} error={error} />
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

const focusOnMount = (link: HTMLAnchorElement | null) => link?.focus();

// The habit deleted while its history is open (marking a day re-renders the page without it): the focused day goes
// away with the calendar, so focus goes to the way back, not to the start of the page.
export function HabitGone() {
  return (
    <div className="flex flex-col items-start gap-4">
      <p role="alert" className="font-medium text-red-700">
        {HABIT_GONE}
      </p>
      <Link href="/app" ref={focusOnMount} className={secondaryButton}>
        Tus hábitos
      </Link>
    </div>
  );
}
