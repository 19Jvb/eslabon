import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { cache } from "react";
import { focusRing, secondaryButton } from "@/app/ui";
import { addMonths, EARLIEST_MONTH, monthTitle, monthWeeks, shownMonth } from "@/lib/dates";
import { fetchAll, PAGE_SIZE } from "@/lib/fetch-all";
import { HabitRef, HABITS_HEADING_ID } from "@/lib/habits";
import { createClient } from "@/lib/supabase/server";
import { userToday } from "@/lib/user-today";
import { HabitListNotice } from "../../habit-forms";
import { HabitGone, HabitHistory } from "./habit-history";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// As in /app: rendered before the HTML is sent, not streamed behind <Suspense>.
export const instant = false;

// One query per request, shared by the title and the page. RLS hides other users' habits: theirs come back as null,
// like a missing one. The proxy has already answered 404 for those; null here is one deleted in between, usually
// seen when marking a day re-renders this page (setCheckIn revalidates it).
const loadHabit = cache(async (id: string) => {
  await connection();
  if (!HabitRef.safeParse({ id }).success) return { habit: null, failed: false };
  const supabase = await createClient();
  const { data, error } = await supabase.from("habits").select("id, name, color").eq("id", id).maybeSingle();
  return { habit: data, failed: error !== null };
});

// Every day of the habit, not only the month shown: the stats need the whole history.
async function loadDays(id: string) {
  const supabase = await createClient();
  const rows = await fetchAll<{ day: string }>((after) => {
    const query = supabase.from("check_ins").select("day", { count: "exact" }).eq("habit_id", id);
    return (after ? query.gt("day", after.day) : query).order("day").limit(PAGE_SIZE);
  });
  return rows?.map((row) => row.day) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { habit } = await loadHabit((await params).id);
  return { title: habit ? `Historial de ${habit.name}` : "Historial" };
}

export default async function HistoryPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { mes } = await searchParams;
  const [{ habit, failed }, today] = await Promise.all([loadHabit(id), userToday()]);
  const days = habit ? await loadDays(habit.id) : null;
  const month = shownMonth(typeof mes === "string" ? mes : undefined, today);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-3 py-8 sm:px-4">
      <Link href="/app" className={`${secondaryButton} self-start`}>
        <span aria-hidden="true">←</span>
        Volver a tus hábitos
      </Link>
      {habit && days ? (
        <HabitListNotice>
          <HabitHistory
            habit={habit}
            marked={days}
            today={today}
            weeks={monthWeeks(month)}
            heading={
              <h1
                id={HABITS_HEADING_ID}
                tabIndex={-1}
                className={`rounded font-display text-2xl font-semibold break-words text-neutral-900 sm:text-3xl ${focusRing}`}
              >
                {habit.name}
              </h1>
            }
          >
            <MonthNav id={habit.id} month={month} today={today} />
          </HabitHistory>
        </HabitListNotice>
      ) : habit === null && !failed ? (
        <HabitGone />
      ) : (
        <p role="alert" className="font-medium text-red-700">
          No se pudo cargar el historial. Recarga la página para intentarlo de nuevo.
        </p>
      )}
    </main>
  );
}

// No «Mes anterior» before January 2000 (the first day that can be marked) and no «Mes siguiente» after today's month.
function MonthNav({ id, month, today }: { id: string; month: string; today: string }) {
  const previous = month > EARLIEST_MONTH ? addMonths(month, -1) : null;
  const next = month < today.slice(0, 7) ? addMonths(month, 1) : null;
  const href = (to: string) => `/app/habitos/${id}?mes=${to}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-xl font-semibold text-neutral-900">{monthTitle(month)}</h2>
      <nav aria-label="Meses" className="flex gap-2">
        {previous && (
          <Link href={href(previous)} className={secondaryButton}>
            Mes anterior
          </Link>
        )}
        {next && (
          <Link href={href(next)} className={secondaryButton}>
            Mes siguiente
          </Link>
        )}
      </nav>
    </div>
  );
}
