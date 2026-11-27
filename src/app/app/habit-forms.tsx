"use client";

import {
  createContext,
  Fragment,
  type ReactNode,
  startTransition,
  use,
  useActionState,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { cellClass, ChainLink, dayCount, HabitStats, HeatmapRowLabels, joinedCorners } from "@/app/habit-look";
import { Spinner } from "@/app/spinner";
import { buttonBase, focusRing, inputClass, pressable } from "@/app/ui";
import { GENERIC_ERROR } from "@/lib/auth";
import { type ActionResult, COLOR_IDS, HABIT_COLORS, HABIT_GONE, HABITS_HEADING_ID, habitColor } from "@/lib/habits";
import { currentStreak, heatmapWeeks } from "@/lib/streak";
import { withFallback } from "@/lib/with-fallback";
import { createHabit, deleteHabit, loadSampleData, renameHabit, setCheckIn } from "./actions";

const failed: ActionResult = { ok: false, error: GENERIC_ERROR };
const createAction = withFallback(createHabit, failed);
const renameAction = withFallback(renameHabit, failed);
const deleteAction = withFallback(deleteHabit, failed);
const checkInAction = withFallback(setCheckIn, failed);
const loadSampleAction = withFallback(loadSampleData, failed);

// The revalidated list drops the row that holds focus: send it to the page h1 instead.
function focusHeading() {
  document.getElementById(HABITS_HEADING_ID)?.focus();
}

const buttonClass = `${buttonBase} text-sm`;
export const primaryButton = `${buttonClass} bg-emerald-700 text-white hover:bg-emerald-800`;
export const secondaryButton = `${buttonClass} border border-neutral-400 bg-white text-neutral-900 hover:bg-neutral-100`;
const dangerButton = `${buttonClass} bg-red-700 text-white hover:bg-red-800`;
const iconButton = `inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-neutral-400 bg-white text-neutral-900 hover:bg-neutral-100 ${pressable} ${focusRing}`;

type Habit = { id: string; name: string; color: string };
type WeekDay = { day: string; label: string; initial: string; date: number };
// What was typed travels in the state: React resets the form after each action, back to these defaults.
type FormState = { error: string | null; name: string };
type NewHabitState = FormState & { color: string };

// The habit's action icons: same 24 grid and stroke; the button's aria-label carries the name.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const PencilIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </Icon>
);

export function ErrorMessage({ id, error }: { id: string; error: string | null }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="text-sm font-medium text-red-700">
      {error}
    </p>
  );
}

// A habit deleted in another tab takes its row (and any error shown in it) away when /app revalidates:
// its message is shown above the list instead.
const ListNotice = createContext<(error: string | null) => void>(() => {});

export function HabitListNotice({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);
  const id = useId();

  return (
    <ListNotice value={setNotice}>
      <ErrorMessage id={id} error={notice} />
      {children}
    </ListNotice>
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
          {/* Two even columns on a phone, three on a tablet, one row from 768 px: no colour left on its own. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:justify-between">
            {COLOR_IDS.map((color) => (
              <label
                key={color}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 text-sm has-checked:border-neutral-900 has-checked:bg-neutral-100"
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

// Only rendered with 0 habits: on success the revalidated list replaces it, so focus goes to the h1.
export function LoadSampleForm() {
  const [error, submit, pending] = useActionState(async (): Promise<string | null> => {
    const result = await loadSampleAction();
    if (!result.ok) return result.error;
    focusHeading();
    return null;
  }, null);
  const id = useId();

  return (
    <form action={submit} className="flex flex-col items-start gap-2">
      <button type="submit" disabled={pending} className={secondaryButton}>
        {pending && <Spinner />}
        Cargar datos de ejemplo
      </button>
      <ErrorMessage id={`${id}-error`} error={error} />
    </form>
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

function Heatmap({ habit, marked, today }: { habit: Habit; marked: string[]; today: string }) {
  const cells = heatmapWeeks(marked, today).flat();
  const done = cells.filter((cell) => cell.done).length;
  const past = cells.filter((cell) => !cell.future).length;

  // Weeks are columns (Monday on top): grid-flow-col fills the 7 rows of each column in order.
  // Done cells are filled, the rest only outlined (WCAG 1.4.1: not just a change of colour).
  // The row labels and the legend repeat what the role="img" name says, so they are hidden from assistive tech.
  return (
    <div className="flex w-fit shrink-0 flex-col gap-2">
      <div className="flex gap-[3px]">
        <HeatmapRowLabels />
        <div
          role="img"
          aria-label={`Historial de 12 semanas de ${habit.name}: ${done} de ${past} días cumplidos`}
          className="grid grid-flow-col grid-rows-7 gap-[3px]"
        >
          {cells.map((cell) => (
            <span
              key={cell.day}
              aria-hidden="true"
              data-day={cell.day}
              data-done={cell.done}
              data-future={cell.future || undefined}
              data-today={cell.day === today || undefined}
              className={`${cellClass(cell.done, cell.future, habit.color)} ${cell.day === today ? "outline-2 outline-offset-1 outline-neutral-900" : ""}`}
            />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-1 text-xs text-neutral-600">
        <span>Últimas 12 semanas</span>
        <span className="flex gap-3">
          {(
            [
              ["Cumplido", true, false],
              ["Sin marcar", false, false],
              ["Futuro", false, true],
            ] as const
          ).map(([text, done, future]) => (
            <span key={text} className="inline-flex items-center gap-1">
              <span className={cellClass(done, future, habit.color)} />
              <span>{text}</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

const toggled = (days: string[], { day, done }: { day: string; done: boolean }) =>
  done ? [...days, day] : days.filter((d) => d !== day);

// The streak figure grows for a moment when the user makes it go up (Web Animations: nothing is remounted).
function pulse(figure: HTMLElement | null) {
  if (!figure || !matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
  figure.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], {
    duration: 180,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  });
}

function DayButtons({ habit, days, marked }: { habit: Habit; days: WeekDay[]; marked: string[] }) {
  const [shown, setShown] = useOptimistic(marked, toggled);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const streakRef = useRef<HTMLElement>(null);
  const notify = use(ListNotice);
  const id = useId();
  const today = days[days.length - 1].day;
  const color = habitColor(habit.color);

  // Only a change made by the user is announced, never the page load.
  const announce = (streak: number) => setAnnouncement(`Racha actual de ${habit.name}: ${dayCount(streak)}`);

  // Sends the intent read from what is on screen, so a fast double click marks and then unmarks.
  function toggle(day: string) {
    const done = !shown.includes(day);
    const before = currentStreak(shown, today);
    const after = currentStreak(toggled(shown, { day, done }), today);
    setError(null);
    notify(null);
    if (after !== before) announce(after);
    if (after > before) pulse(streakRef.current);
    startTransition(async () => {
      setShown({ day, done });
      const result = await checkInAction({ habitId: habit.id, day, done });
      if (result.ok) return;
      // Rolled back: the streak on screen is the old one again.
      if (after !== before) announce(before);
      if (result.error === HABIT_GONE) {
        notify(result.error);
        focusHeading();
      } else {
        setError(result.error);
      }
    });
  }

  // From 768 px: the days with their stats on the left and the heatmap on the right; stacked below that.
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-8">
      <div className="flex flex-col gap-3">
        {/* The chain follows the optimistic days and appears at once (no transition). */}
        <div className="flex items-center">
          {days.map(({ day, label, initial, date }, i) => {
            const linked = i > 0 && shown.includes(day) && shown.includes(days[i - 1].day);
            const linkedRight = i < days.length - 1 && shown.includes(day) && shown.includes(days[i + 1].day);
            return (
              <Fragment key={day}>
                {i > 0 && <ChainLink linked={linked} color={habit.color} />}
                <button
                  type="button"
                  data-day={day}
                  aria-pressed={shown.includes(day)}
                  onClick={() => toggle(day)}
                  className={`flex size-11 shrink-0 flex-col items-center justify-center rounded-lg text-neutral-700 hover:bg-neutral-100 aria-pressed:text-white motion-safe:transition-[color,background-color,border-color,scale] motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.97] ${day === today ? "border-2 border-neutral-900" : "border border-neutral-500"} ${joinedCorners(linked, linkedRight)} ${color.pressed} ${focusRing}`}
                >
                  {/* The name comes from this text, not aria-label: axe (WCAG 2.5.3) flags an aria-label that
                      does not contain the visible «J 26». Today and yesterday say so instead of an initial. */}
                  <span className="sr-only">{`${label}: ${habit.name}`}</span>
                  <span aria-hidden="true" className="mb-1 text-xs leading-none">
                    {i >= days.length - 2 ? label : initial}
                  </span>
                  <span aria-hidden="true" className="text-sm leading-tight font-semibold tabular-nums">
                    {date}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>
        <ErrorMessage id={`${id}-error`} error={error} />
        <HabitStats marked={shown} today={today} color={habit.color} streakRef={streakRef} />
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
      <Heatmap habit={habit} marked={shown} today={today} />
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
      <div className="flex items-center gap-2 sm:gap-3">
        <span aria-hidden="true" className={`size-4 shrink-0 rounded-full ${habitColor(habit.color).swatch}`} />
        {editing ? (
          <RenameForm habit={habit} onDone={stopEditing} />
        ) : (
          <>
            <span className="min-w-0 flex-1 font-medium break-words text-neutral-900">{habit.name}</span>
            <div className="flex shrink-0 gap-1 sm:gap-2">
              <button
                type="button"
                ref={(button) => {
                  if (button && focusRename.current) {
                    focusRename.current = false;
                    button.focus();
                  }
                }}
                aria-label={`Renombrar ${habit.name}`}
                title={`Renombrar ${habit.name}`}
                onClick={() => setEditing(true)}
                className={iconButton}
              >
                <PencilIcon />
              </button>
              <button
                type="button"
                ref={deleteButtonRef}
                aria-label={`Borrar ${habit.name}`}
                title={`Borrar ${habit.name}`}
                onClick={openDialog}
                className={iconButton}
              >
                <TrashIcon />
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
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white p-6 shadow-xl backdrop:bg-neutral-900/50 starting:scale-97 starting:opacity-0 motion-safe:transition-[opacity,scale] motion-safe:duration-150 motion-safe:ease-out"
      >
        {/* Enters with a short fade and scale from @starting-style; it closes at once. Its buttons are 48 px
            tall, so even at the 0.97 of the entry they stay at 44 px or more. */}
        <p id={`${id}-question`} className="break-words text-neutral-900">
          ¿Borrar «{habit.name}»? Se perderá su historial.
        </p>
        <div className="mt-2">
          <ErrorMessage id={`${id}-error`} error={deleteError} />
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => dialogRef.current?.close()} className={`${secondaryButton} py-3.5`}>
            Cancelar
          </button>
          <button type="button" onClick={confirmDelete} disabled={deleting} className={`${dangerButton} py-3.5`}>
            {deleting && <Spinner />}
            Sí, borrar
          </button>
        </div>
      </dialog>
    </li>
  );
}
