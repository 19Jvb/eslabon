"use client";

import { startTransition, useActionState, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { Spinner } from "@/app/spinner";
import { GENERIC_ERROR } from "@/lib/auth";
import { type ActionResult, COLOR_IDS, HABIT_COLORS, HABIT_GONE, HABITS_HEADING_ID, swatchClass } from "@/lib/habits";
import { withFallback } from "@/lib/with-fallback";
import { createHabit, deleteHabit, renameHabit, setCheckIn } from "./actions";

const failed: ActionResult = { ok: false, error: GENERIC_ERROR };
const createAction = withFallback(createHabit, failed);
const renameAction = withFallback(renameHabit, failed);
const deleteAction = withFallback(deleteHabit, failed);
const checkInAction = withFallback(setCheckIn, failed);

// The revalidated list drops the row that holds focus: send it to the page h1 instead.
function focusHeading() {
  document.getElementById(HABITS_HEADING_ID)?.focus();
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";
const inputClass = `min-h-11 w-full rounded-lg border border-neutral-400 bg-white px-3 text-base text-neutral-900 aria-invalid:border-red-700 ${focusRing}`;
const buttonClass = `inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
const primaryButton = `${buttonClass} bg-emerald-700 text-white hover:bg-emerald-800`;
const secondaryButton = `${buttonClass} border border-neutral-400 bg-white text-neutral-900 hover:bg-neutral-100`;
const dangerButton = `${buttonClass} bg-red-700 text-white hover:bg-red-800`;

type Habit = { id: string; name: string; color: string };
type WeekDay = { day: string; label: string; initial: string; date: number };
// What was typed travels in the state: React resets the form after each action, back to these defaults.
type FormState = { error: string | null; name: string };
type NewHabitState = FormState & { color: string };

function ErrorMessage({ id, error }: { id: string; error: string | null }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="text-sm font-medium text-red-700">
      {error}
    </p>
  );
}

async function submitNewHabit(_prev: NewHabitState, formData: FormData): Promise<NewHabitState> {
  const name = String(formData.get("name") ?? "");
  const color = String(formData.get("color") ?? "");
  const result = await createAction({ name, color });
  return result.ok ? { error: null, name: "", color } : { error: result.error, name, color };
}

export function NewHabitForm() {
  const [state, submit, pending] = useActionState(submitNewHabit, { error: null, name: "", color: "green" });
  const id = useId();

  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-6">
      <h2 id={`${id}-heading`} className="text-lg font-semibold text-neutral-900">
        Nuevo hábito
      </h2>
      <form action={submit} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-name`} className="font-medium">
            Nombre
          </label>
          <input
            id={`${id}-name`}
            name="name"
            type="text"
            autoComplete="off"
            defaultValue={state.name}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? `${id}-error` : undefined}
            className={inputClass}
          />
          <ErrorMessage id={`${id}-error`} error={state.error} />
        </div>
        <fieldset>
          <legend className="mb-2 font-medium">Color</legend>
          <div className="flex flex-wrap gap-2">
            {COLOR_IDS.map((color) => (
              <label
                key={color}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-neutral-300 px-3 text-sm has-checked:border-neutral-900 has-checked:bg-neutral-100"
              >
                <input
                  type="radio"
                  name="color"
                  value={color}
                  defaultChecked={color === state.color}
                  className={`size-4 accent-emerald-700 ${focusRing}`}
                />
                <span aria-hidden="true" className={`size-4 rounded-full ${HABIT_COLORS[color].swatch}`} />
                {HABIT_COLORS[color].label}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={pending} className={`${primaryButton} self-start`}>
          {pending && <Spinner />}
          Crear
        </button>
      </form>
    </section>
  );
}

function RenameForm({ habit, onDone }: { habit: Habit; onDone: () => void }) {
  const [state, save, saving] = useActionState(
    async (_prev: FormState, formData: FormData): Promise<FormState> => {
      const name = String(formData.get("name") ?? "");
      const result = await renameAction({ id: habit.id, name });
      if (!result.ok && result.error === HABIT_GONE) focusHeading();
      if (!result.ok) return { error: result.error, name };
      startTransition(onDone);
      return { error: null, name };
    },
    { error: null, name: habit.name },
  );
  const id = useId();

  return (
    <form
      action={save}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone();
      }}
      className="flex min-w-0 flex-1 flex-col gap-2"
    >
      <label htmlFor={`${id}-name`} className="font-medium">
        Nuevo nombre
      </label>
      <input
        id={`${id}-name`}
        name="name"
        type="text"
        autoComplete="off"
        autoFocus
        defaultValue={state.name}
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? `${id}-error` : undefined}
        className={inputClass}
      />
      <ErrorMessage id={`${id}-error`} error={state.error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving && <Spinner />}
          Guardar
        </button>
        <button type="button" onClick={onDone} className={secondaryButton}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function DayButtons({ habit, days, marked }: { habit: Habit; days: WeekDay[]; marked: string[] }) {
  const [shown, setShown] = useOptimistic(marked, (current, { day, done }: { day: string; done: boolean }) =>
    done ? [...current, day] : current.filter((d) => d !== day),
  );
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  // Sends the intent read from what is on screen, so a fast double click marks and then unmarks.
  function toggle(day: string) {
    const done = !shown.includes(day);
    setError(null);
    startTransition(async () => {
      setShown({ day, done });
      const result = await checkInAction({ habitId: habit.id, day, done });
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between sm:justify-start sm:gap-2">
        {days.map(({ day, label, initial, date }) => (
          <button
            key={day}
            type="button"
            data-day={day}
            aria-pressed={shown.includes(day)}
            onClick={() => toggle(day)}
            className={`flex size-11 flex-col items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100 aria-pressed:border-emerald-700 aria-pressed:bg-emerald-700 aria-pressed:text-white aria-pressed:hover:bg-emerald-800 ${focusRing}`}
          >
            {/* The name comes from this text, not aria-label: axe (WCAG 2.5.3) flags an aria-label that
                does not contain the visible «J 26». */}
            <span className="sr-only">{`${label}: ${habit.name}`}</span>
            <span aria-hidden="true" className="text-xs leading-none">
              {initial}
            </span>
            <span aria-hidden="true" className="text-sm leading-tight font-semibold">
              {date}
            </span>
          </button>
        ))}
      </div>
      <ErrorMessage id={`${id}-error`} error={error} />
    </div>
  );
}

export function HabitItem({ habit, days, marked }: { habit: Habit; days: WeekDay[]; marked: string[] }) {
  const [editing, setEditing] = useState(false);
  const [deleting, startDeleting] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  // Focus goes back to «Renombrar» when the inline form closes, and nowhere near a removed habit.
  const focusRename = useRef(false);
  const deleted = useRef(false);
  const id = useId();

  function stopEditing() {
    focusRename.current = true;
    setEditing(false);
  }

  function openDialog() {
    setDeleteError(null);
    dialogRef.current?.showModal();
  }

  function confirmDelete() {
    startDeleting(async () => {
      const result = await deleteAction({ id: habit.id });
      // Already gone (deleted in another tab) is what the user asked for: close as if it succeeded.
      if (!result.ok && result.error !== HABIT_GONE) {
        setDeleteError(result.error);
        return;
      }
      deleted.current = true;
      dialogRef.current?.close();
      focusHeading();
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 sm:p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={`size-4 shrink-0 rounded-full ${swatchClass(habit.color)}`} />
        {editing ? (
          <RenameForm habit={habit} onDone={stopEditing} />
        ) : (
          <>
            <span className="min-w-0 flex-1 font-medium break-words text-neutral-900">{habit.name}</span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                ref={(button) => {
                  if (button && focusRename.current) {
                    focusRename.current = false;
                    button.focus();
                  }
                }}
                aria-label={`Renombrar ${habit.name}`}
                onClick={() => setEditing(true)}
                className={secondaryButton}
              >
                Renombrar
              </button>
              <button
                type="button"
                ref={deleteButtonRef}
                aria-label={`Borrar ${habit.name}`}
                onClick={openDialog}
                className={secondaryButton}
              >
                Borrar
              </button>
            </div>
          </>
        )}
      </div>
      <DayButtons habit={habit} days={days} marked={marked} />
      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-question`}
        onClose={() => {
          if (!deleted.current) deleteButtonRef.current?.focus();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white p-6 shadow-xl backdrop:bg-neutral-900/50"
      >
        <p id={`${id}-question`} className="break-words text-neutral-900">
          ¿Borrar «{habit.name}»? Se perderá su historial.
        </p>
        <div className="mt-2">
          <ErrorMessage id={`${id}-error`} error={deleteError} />
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => dialogRef.current?.close()} className={secondaryButton}>
            Cancelar
          </button>
          <button type="button" onClick={confirmDelete} disabled={deleting} className={dangerButton}>
            {deleting && <Spinner />}
            Sí, borrar
          </button>
        </div>
      </dialog>
    </li>
  );
}
