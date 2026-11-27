import { habitColor } from "@/lib/habits";

// The look of a habit card, shared by /app and the landing preview so both draw the same chain and heatmap.

// Empty and future cells are outlined in neutral-500: 3:1 or more on white (WCAG 1.4.11).
export const cellClass = (done: boolean, future: boolean, color: string) =>
  `size-3 rounded-[3px] border ${future ? "border-dashed border-neutral-500" : done ? habitColor(color).done : "border-neutral-500"}`;

// Between two marked days, a link drawn in the habit's colour: the chain. The gaps grow to fill a phone
// and stay at 8 px above.
export function ChainLink({ linked, color }: { linked: boolean; color: string }) {
  return (
    <span
      aria-hidden="true"
      data-link={linked || undefined}
      className={`h-1 flex-1 sm:w-2 sm:flex-none ${linked ? habitColor(color).link : ""}`}
    />
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
