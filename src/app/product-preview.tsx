import { HABIT_COLORS } from "@/lib/habits";

// A fixed 12-week pattern (weeks are columns, Monday on top): the landing is static, so no real dates.
// The last week is the day row: done Monday to Friday, the weekend still to come.
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
  "1111100",
];
const INITIALS = ["L", "M", "X", "J", "V", "S", "D"];
const { swatch, done } = HABIT_COLORS.blue;

// A picture of a habit card, hidden from assistive tech: the text around it already says what the app does.
export function ProductPreview() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-xl px-4 pb-14">
      <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-3 font-medium text-neutral-900">
            <span className={`size-4 rounded-full ${swatch}`} />
            Leer 20 minutos
          </p>
          <div className="flex gap-1.5">
            {INITIALS.map((initial, i) => (
              <span
                key={initial}
                className={`flex size-9 items-center justify-center rounded-lg border text-xs font-semibold ${
                  WEEKS[WEEKS.length - 1][i] === "1" ? "border-blue-700 bg-blue-700 text-white" : "border-neutral-500 text-neutral-700"
                }`}
              >
                {initial}
              </span>
            ))}
          </div>
        </div>
        <div className="grid w-fit grid-flow-col grid-rows-7 gap-[3px]">
          {WEEKS.flatMap((week, w) =>
            [...week].map((day, d) => (
              <span key={`${w}-${d}`} className={`size-3 rounded-[3px] border ${day === "1" ? done : "border-neutral-500"}`} />
            )),
          )}
        </div>
      </div>
    </div>
  );
}
