"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { GENERIC_ERROR } from "@/lib/auth";
import { type ActionResult, HABIT_GONE, HabitRef, habitErrorMessage, NewHabit, RenameHabit } from "@/lib/habits";
import { createClient } from "@/lib/supabase/server";

type SignOutState = { error: string } | null;

const SESSION_EXPIRED: ActionResult = { ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." };

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
