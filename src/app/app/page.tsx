import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { HABITS_HEADING_ID } from "@/lib/habits";
import { createClient } from "@/lib/supabase/server";
import { HabitItem, NewHabitForm } from "./habit-forms";

export const metadata: Metadata = { title: "Tus hábitos" };

export default function AppPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8">
      <h1 id={HABITS_HEADING_ID} tabIndex={-1} className="rounded text-2xl font-semibold text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
        Tus hábitos
      </h1>
      <Suspense fallback={<p className="text-neutral-600">Cargando tus hábitos…</p>}>
        <HabitList />
      </Suspense>
      <NewHabitForm />
    </main>
  );
}

async function HabitList() {
  await connection();
  const supabase = await createClient();
  const { data: habits, error } = await supabase.from("habits").select("id, name, color").order("created_at");

  if (error) {
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
        <HabitItem key={habit.id} habit={habit} />
      ))}
    </ul>
  );
}
