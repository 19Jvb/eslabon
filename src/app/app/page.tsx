import type { Metadata } from "next";
import { connection } from "next/server";
import { focusRing } from "@/app/ui";
import { dayNames, lastWeek, longDateIn } from "@/lib/dates";
import { fetchAll, PAGE_SIZE } from "@/lib/fetch-all";
import { HABITS_HEADING_ID } from "@/lib/habits";
import { createClient } from "@/lib/supabase/server";
import { botUsername } from "@/lib/telegram";
import { userTimeZone, userToday } from "@/lib/user-today";
import { HabitItem, HabitListNotice, LoadSampleForm, NewHabitForm } from "./habit-forms";
import { TelegramLink } from "./telegram-forms";

export const metadata: Metadata = { title: "Tus hábitos" };
// The list is rendered before the HTML is sent, not streamed behind <Suspense>: without JavaScript a
// streamed boundary never leaves its fallback. false lets this page block instead of needing a static shell.
export const instant = false;

export default function AppPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-3 py-8 sm:px-4">
      <h1 id={HABITS_HEADING_ID} tabIndex={-1} className={`rounded text-2xl font-semibold text-neutral-900 ${focusRing}`}>
        Tus hábitos
      </h1>
      <HabitListNotice>
        <HabitList />
      </HabitListNotice>
      <TelegramSection />
      <NewHabitForm />
    </main>
  );
}

async function HabitList() {
  await connection();
  const today = await userToday();
  const days = lastWeek(today).map((day) => ({ day, ...dayNames(day, today) }));
  const supabase = await createClient();
  // Every check-in of every habit, not one query per habit: the best streak needs the whole history.
  const [{ data: habits, error }, checkIns] = await Promise.all([
    supabase.from("habits").select("id, name, color").order("created_at"),
    fetchAll<{ habit_id: string; day: string }>((after) => {
      const query = supabase.from("check_ins").select("habit_id, day", { count: "exact" });
      // Keyset on the primary key: the rows after (habit_id, day) of the last row read.
      const rest = after
        ? query.or(`habit_id.gt.${after.habit_id},and(habit_id.eq.${after.habit_id},day.gt.${after.day})`)
        : query;
      return rest.order("habit_id").order("day").limit(PAGE_SIZE);
    }),
  ]);

  if (error || !checkIns) {
    return (
      <p role="alert" className="font-medium text-red-700">
        No se pudieron cargar tus hábitos. Recarga la página para intentarlo de nuevo.
      </p>
    );
  }
  if (habits.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-neutral-700">
          Aún no tienes hábitos. Crea el primero en «Nuevo hábito».
        </p>
        <LoadSampleForm />
      </div>
    );
  }

  const byHabit = Map.groupBy(checkIns, (checkIn) => checkIn.habit_id);
  return (
    <ul className="flex flex-col gap-3">
      {habits.map((habit) => (
        <HabitItem
          key={habit.id}
          habit={habit}
          days={days}
          marked={(byHabit.get(habit.id) ?? []).map((checkIn) => checkIn.day)}
        />
      ))}
    </ul>
  );
}

const TELEGRAM_HEADING_ID = "telegram-heading";

async function TelegramSection() {
  await connection();
  const bot = botUsername(process.env.TELEGRAM_BOT_USERNAME);

  return (
    <section aria-labelledby={TELEGRAM_HEADING_ID} className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-6">
      <h2 id={TELEGRAM_HEADING_ID} className="text-lg font-semibold text-neutral-900">
        Telegram
      </h2>
      {bot ? <TelegramStatus bot={bot} /> : <p className="mt-2 text-neutral-700">Telegram no está disponible ahora mismo.</p>}
    </section>
  );
}

// Whether the user has linked the bot: only user_id and linked_at, the columns the API may read (chat_id is not).
async function TelegramStatus({ bot }: { bot: string }) {
  const supabase = await createClient();
  const { data: link, error } = await supabase.from("telegram_links").select("user_id, linked_at").maybeSingle();
  if (error) {
    return (
      <p role="alert" className="mt-2 font-medium text-red-700">
        No se pudo comprobar la vinculación con Telegram. Recarga la página para intentarlo de nuevo.
      </p>
    );
  }

  const linkedSince = link ? longDateIn(link.linked_at, await userTimeZone()) : null;
  return <TelegramLink bot={bot} linkedSince={linkedSince} />;
}
