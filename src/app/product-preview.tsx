import { Fragment } from "react";
import { cellClass, ChainLink, HeatmapRowLabels } from "@/app/habit-look";
import { habitColor } from "@/lib/habits";

// A fixed 12-week pattern (weeks are columns, Monday on top): the landing is static, so no real dates.
// Today is a Sunday, so the last week is the day row, still unmarked today.
const WEEKS = [
  "1001010",
  "1101100",
  "0111011",
  "1110110",
  "1011111",
  "1111101",
  "0111111",
  "1101111",
  "1111111",
  "1110111",
  "1111111",
  "1101110",
];
const DAYS = ["L", "M", "X", "J", "V", "Ayer", "Hoy"];
const THIS_WEEK = WEEKS[WEEKS.length - 1];
const COLOR = "blue";
const { swatch } = habitColor(COLOR);

// A picture of a habit card as /app draws it, hidden from assistive tech: the text around it already says
// what the app does.
export function ProductPreview() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-xl px-4 pb-14">
      <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-3 sm:mx-auto sm:w-fit sm:p-5">
        <p className="flex items-center gap-3 font-medium text-neutral-900">
          <span className={`size-4 rounded-full ${swatch}`} />
          Leer 20 minutos
        </p>
        <div className="flex items-center">
          {DAYS.map((label, i) => {
            const done = THIS_WEEK[i] === "1";
            const today = i === DAYS.length - 1;
            // As the day buttons: marked in the habit's 700, today with a thicker dark outline.
            const look = done
              ? "border-blue-700 bg-blue-700 text-white"
              : today
                ? "border-neutral-900 text-neutral-700"
                : "border-neutral-500 text-neutral-700";
            return (
              <Fragment key={label}>
                {i > 0 && <ChainLink linked={done && THIS_WEEK[i - 1] === "1"} color={COLOR} />}
                <span
                  className={`flex size-11 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${today ? "border-2" : "border"} ${look}`}
                >
                  {label}
                </span>
              </Fragment>
            );
          })}
        </div>
        <div className="flex w-fit gap-[3px]">
          <HeatmapRowLabels />
          <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
            {WEEKS.flatMap((week, w) =>
              [...week].map((day, d) => (
                <span
                  key={`${w}-${d}`}
                  className={`${cellClass(day === "1", false, COLOR)} ${
                    w === WEEKS.length - 1 && d === 6 ? "outline-2 outline-offset-1 outline-neutral-900" : ""
                  }`}
                />
              )),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
