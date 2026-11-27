import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/auth";

// The only palette: ids match the DB check constraint, labels are what the user sees. A habit's color runs
// through its chain: swatch and done heatmap cells in 600 (3:1 or more on white); marked day buttons, the link
// between them and the current streak in 700 (4.5:1 or more on white). Tailwind only generates classes written
// out in full, hence the repetition.
export const HABIT_COLORS = {
  red: {
    label: "Rojo",
    swatch: "bg-red-600",
    pressed: "aria-pressed:border-red-700 aria-pressed:bg-red-700 aria-pressed:hover:bg-red-800",
    done: "border-red-600 bg-red-600",
    streak: "text-red-700",
    link: "bg-red-700",
  },
  orange: {
    label: "Naranja",
    swatch: "bg-orange-600",
    pressed: "aria-pressed:border-orange-700 aria-pressed:bg-orange-700 aria-pressed:hover:bg-orange-800",
    done: "border-orange-600 bg-orange-600",
    streak: "text-orange-700",
    link: "bg-orange-700",
  },
  amber: {
    label: "Ámbar",
    swatch: "bg-amber-600",
    pressed: "aria-pressed:border-amber-700 aria-pressed:bg-amber-700 aria-pressed:hover:bg-amber-800",
    done: "border-amber-600 bg-amber-600",
    streak: "text-amber-700",
    link: "bg-amber-700",
  },
  green: {
    label: "Verde",
    swatch: "bg-green-600",
    pressed: "aria-pressed:border-green-700 aria-pressed:bg-green-700 aria-pressed:hover:bg-green-800",
    done: "border-green-600 bg-green-600",
    streak: "text-green-700",
    link: "bg-green-700",
  },
  blue: {
    label: "Azul",
    swatch: "bg-blue-600",
    pressed: "aria-pressed:border-blue-700 aria-pressed:bg-blue-700 aria-pressed:hover:bg-blue-800",
    done: "border-blue-600 bg-blue-600",
    streak: "text-blue-700",
    link: "bg-blue-700",
  },
  violet: {
    label: "Violeta",
    swatch: "bg-violet-600",
    pressed: "aria-pressed:border-violet-700 aria-pressed:bg-violet-700 aria-pressed:hover:bg-violet-800",
    done: "border-violet-600 bg-violet-600",
    streak: "text-violet-700",
    link: "bg-violet-700",
  },
} as const;

type HabitColor = keyof typeof HABIT_COLORS;
export const COLOR_IDS = Object.keys(HABIT_COLORS) as [HabitColor, ...HabitColor[]];

// The DB only accepts palette ids; neutral is for anything else, so a bad row still renders.
const UNKNOWN_COLOR = {
  swatch: "bg-neutral-500",
  pressed: "aria-pressed:border-neutral-700 aria-pressed:bg-neutral-700 aria-pressed:hover:bg-neutral-800",
  done: "border-neutral-600 bg-neutral-600",
  streak: "text-neutral-700",
  link: "bg-neutral-700",
};

export function habitColor(color: string): typeof UNKNOWN_COLOR {
  return Object.hasOwn(HABIT_COLORS, color) ? HABIT_COLORS[color as HabitColor] : UNKNOWN_COLOR;
}

const DUPLICATE_HABIT = "Ya tienes un hábito con ese nombre.";

// The page h1: where focus goes when the focused habit disappears.
export const HABITS_HEADING_ID = "habits-heading";

export type ActionResult = { ok: true } | { ok: false; error: string };

const EMPTY_NAME = "Escribe un nombre";
const HabitName = z.string(EMPTY_NAME).trim().min(1, EMPTY_NAME).max(60, "Máximo 60 caracteres");
const HabitId = z.uuid(GENERIC_ERROR);

// The object-level message covers a body that is not an object (forged request): zod's default is English.
export const NewHabit = z.object({ name: HabitName, color: z.enum(COLOR_IDS, "Elige un color") }, GENERIC_ERROR);
export const RenameHabit = z.object({ id: HabitId, name: HabitName }, GENERIC_ERROR);
export const HabitRef = z.object({ id: HabitId }, GENERIC_ERROR);
// done is the intent (mark or unmark), not a toggle: a stale screen still ends in the state the user saw.
// The day's range depends on the user's today, so the action checks it with isEditableDay.
export const CheckIn = z.object({ habitId: HabitId, day: z.string(GENERIC_ERROR), done: z.boolean(GENERIC_ERROR) }, GENERIC_ERROR);

// loadSampleData takes nothing from the client: anything sent (a forged request) is rejected.
export const NoInput = z.undefined(GENERIC_ERROR);

export const OUT_OF_RANGE = "Solo puedes marcar los últimos 7 días.";

export const HABIT_GONE = "Ese hábito ya no existe.";

// Translates by Postgres error code, never by the raw message.
export function habitErrorMessage(code: string | undefined): string {
  return code === "23505" ? DUPLICATE_HABIT : GENERIC_ERROR;
}
