import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/auth";

// The only palette: ids match the DB check constraint, labels are what the user sees.
export const HABIT_COLORS = {
  red: { label: "Rojo", swatch: "bg-red-600" },
  orange: { label: "Naranja", swatch: "bg-orange-500" },
  amber: { label: "Ámbar", swatch: "bg-amber-400" },
  green: { label: "Verde", swatch: "bg-green-600" },
  blue: { label: "Azul", swatch: "bg-blue-600" },
  violet: { label: "Violeta", swatch: "bg-violet-600" },
} as const;

type HabitColor = keyof typeof HABIT_COLORS;
export const COLOR_IDS = Object.keys(HABIT_COLORS) as [HabitColor, ...HabitColor[]];

export function swatchClass(color: string): string {
  return Object.hasOwn(HABIT_COLORS, color) ? HABIT_COLORS[color as HabitColor].swatch : "bg-neutral-400";
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

export const OUT_OF_RANGE = "Solo puedes marcar los últimos 7 días.";

export const HABIT_GONE = "Ese hábito ya no existe.";

// Translates by Postgres error code, never by the raw message.
export function habitErrorMessage(code: string | undefined): string {
  return code === "23505" ? DUPLICATE_HABIT : GENERIC_ERROR;
}
