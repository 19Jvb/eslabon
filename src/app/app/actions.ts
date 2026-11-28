"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { GENERIC_ERROR } from "@/lib/auth";
import { isEditableDay } from "@/lib/dates";
import {
  type ActionResult,
  CheckIn,
  HABIT_GONE,
  HabitRef,
  habitErrorMessage,
  NewHabit,
  NoInput,
  OUT_OF_RANGE,
  RenameHabit,
} from "@/lib/habits";
import { createClient } from "@/lib/supabase/server";
import { userTimeZone, userToday } from "@/lib/user-today";

type SignOutState = { error: string } | null;
type LinkCodeResult = { ok: true; code: string } | { ok: false; error: string };
type LinkStatusResult = { ok: true; linked: boolean } | { ok: false; error: string };

const SESSION_EXPIRED: { ok: false; error: string } = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };

// scope "local" closes only this browser's session: the demo account is shared, and the default
// ("global") would sign every visitor out.
export async function signOut(): Promise<SignOutState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) return { error: GENERIC_ERROR };

  redirect("/login");
}

export async function createHabit(input: unknown): Promise<ActionResult> {
  const parsed = NewHabit.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;

  const { error } = await supabase.from("habits").insert(parsed.data);
  if (error) return { ok: false, error: habitErrorMessage(error.code) };

  revalidatePath("/app");
  return { ok: true };
}

// update({ name }) only, never upsert: the update grant covers just name and color.
export async function renameHabit(input: unknown): Promise<ActionResult> {
  const parsed = RenameHabit.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;

  const { error, count } = await supabase
    .from("habits")
    .update({ name: parsed.data.name }, { count: "exact" })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: habitErrorMessage(error.code) };

  revalidatePath("/app");
  // RLS turns someone else's id (or one deleted in another tab) into 0 rows, not an error.
  return count === 1 ? { ok: true } : { ok: false, error: HABIT_GONE };
}

export async function deleteHabit(input: unknown): Promise<ActionResult> {
  const parsed = HabitRef.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;

  const { error, count } = await supabase.from("habits").delete({ count: "exact" }).eq("id", parsed.data.id);
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/app");
  return count === 1 ? { ok: true } : { ok: false, error: HABIT_GONE };
}

// Insert to mark and delete to unmark, never update or upsert (check_ins has no update grant).
// Both are idempotent: the row already there (23505) or already gone is the state the user asked for.
export async function setCheckIn(input: unknown): Promise<ActionResult> {
  const parsed = CheckIn.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { habitId, day, done } = parsed.data;
  if (!isEditableDay(day, await userToday())) return { ok: false, error: OUT_OF_RANGE };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;

  const { error } = done
    ? await supabase.from("check_ins").insert({ habit_id: habitId, day })
    : await supabase.from("check_ins").delete().eq("habit_id", habitId).eq("day", day);
  // The insert policy rejects (42501) a habit that is not the user's own or no longer exists, but also a day outside
  // its window or a revoked grant: only a habit that is really not there says so. 23503 is the FK, if it is deleted
  // between the policy check and the insert. Revalidating removes the row from the list.
  if (done && error?.code === "42501") {
    const lookup = await supabase.from("habits").select("id").eq("id", habitId).maybeSingle();
    if (lookup.error || lookup.data) return { ok: false, error: GENERIC_ERROR };
  }
  if (done && (error?.code === "42501" || error?.code === "23503")) {
    revalidatePath("/app");
    revalidatePath(`/app/habitos/${habitId}`);
    return { ok: false, error: HABIT_GONE };
  }
  if (error && !(done && error.code === "23505")) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/app");
  revalidatePath(`/app/habitos/${habitId}`);
  return { ok: true };
}

// Creates the 3 sample habits with their history only if the user has none (the SQL function checks it under a
// per-user lock, so a double click or two tabs end with exactly 3). The day is the user's today from the tz cookie.
export async function loadSampleData(input?: unknown): Promise<ActionResult> {
  const parsed = NoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;

  const { error } = await supabase.rpc("load_sample_data", { p_today: await userToday() });
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/app");
  return { ok: true };
}

// A one-time code for the bot (valid 10 minutes; the previous one stops working). The zone that travels with it
// comes from the tz cookie on the server, never from the client.
export async function createTelegramLinkCode(input?: unknown): Promise<LinkCodeResult> {
  const parsed = NoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;

  const { data, error } = await supabase.rpc("create_telegram_link_code", { p_tz: await userTimeZone() });
  if (error || !data) return { ok: false, error: GENERIC_ERROR };

  return { ok: true, code: data };
}

// Read only: whether the bot has linked the user yet. Once it has, the revalidated page shows the link.
export async function checkTelegramLink(input?: unknown): Promise<LinkStatusResult> {
  const parsed = NoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;

  const { data, error } = await supabase.from("telegram_links").select("user_id").maybeSingle();
  if (error) return { ok: false, error: GENERIC_ERROR };

  if (data) revalidatePath("/app");
  return { ok: true, linked: data !== null };
}

// Without .select(): the select grant covers only some columns, and returning every one of them fails (42501).
export async function unlinkTelegram(input?: unknown): Promise<ActionResult> {
  const parsed = NoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;

  const { error } = await supabase.from("telegram_links").delete().eq("user_id", user.id);
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/app");
  return { ok: true };
}
