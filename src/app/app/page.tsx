import type { Metadata } from "next";
import { connection } from "next/server";
import { dayNames, lastWeek } from "@/lib/dates";
import { HABITS_HEADING_ID } from "@/lib/habits";
import { createClient } from "@/lib/supabase/server";
import { userToday } from "@/lib/user-today";
import { HabitItem, NewHabitForm } from "./habit-forms";

export const metadata: Metadata = { title: "Tus hábitos" };
// The list is rendered before the HTML is sent, not streamed behind <Suspense>: without JavaScript a
// streamed boundary never leaves its fallback. false lets this page block instead of needing a static shell.
export const instant = false;

export default function AppPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8">
      <h1 id={HABITS_HEADING_ID} tabIndex={-1} className="rounded text-2xl font-semibold text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
        Tus hábitos
      </h1>
      <HabitList />
      <NewHabitForm />
    </main>
  );
}

async function HabitList() {
  await connection();
  const today = await userToday();
  const days = lastWeek(today).map((day) => ({ day, ...dayNames(day, today) }));
  const supabase = await createClient();
  // One query for every habit's check-ins in the week, not one per habit.
  const [{ data: habits, error }, { data: checkIns, error: checkInsError }] = await Promise.all([
    supabase.from("habits").select("id, name, color").order("created_at"),
    supabase.from("check_ins").select("habit_id, day").gte("day", days[0].day).lte("day", today),
  ]);

  if (error || checkInsError) {
    return (
      <p role="alert" className="font-medium text-red-700">
        No se pudieron cargar tus hábitos. Recarga la página para intentarlo de nuevo.
      </p>
    );
  }
  if (habits.length === 0) {
    return <p className="text-neutral-700">Aún no tienes hábitos. Crea el primero con el formulario de abajo.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {habits.map((habit) => (
        <HabitItem
          key={habit.id}
          habit={habit}
          days={days}
          marked={checkIns.filter((checkIn) => checkIn.habit_id === habit.id).map((checkIn) => checkIn.day)}
        />
      ))}
    </ul>
  );
}
