"use server";

import { redirect } from "next/navigation";
import { authErrorMessage, Credentials, GENERIC_ERROR, NewAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type AuthState = { error: string; field?: "email" | "password"; email?: string } | null;

function fieldError(issue: { message: string; path: PropertyKey[] }, email: unknown): AuthState {
  const field = issue.path[0] === "email" || issue.path[0] === "password" ? issue.path[0] : undefined;
  return { error: issue.message, field, email: typeof email === "string" ? email : undefined };
}

// A forged request can send anything instead of FormData: answer it, never a 500.
export async function signIn(_prev: AuthState, formData: unknown): Promise<AuthState> {
  if (!(formData instanceof FormData)) return { error: GENERIC_ERROR };
  const input = Object.fromEntries(formData);
  const parsed = Credentials.safeParse(input);
  if (!parsed.success) return fieldError(parsed.error.issues[0], input.email);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authErrorMessage(error.code), email: parsed.data.email };

  redirect("/app");
}

export async function signUp(_prev: AuthState, formData: unknown): Promise<AuthState> {
  if (!(formData instanceof FormData)) return { error: GENERIC_ERROR };
  const input = Object.fromEntries(formData);
  const parsed = NewAccount.safeParse(input);
  if (!parsed.success) return fieldError(parsed.error.issues[0], input.email);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) return { error: authErrorMessage(error.code), email: parsed.data.email };
  // Without a session (email confirmation turned on by mistake) /app would bounce back to /login.
  if (!data.session) return { error: GENERIC_ERROR, email: parsed.data.email };

  redirect("/app");
}

// The demo credentials are read only here, on the server; they never reach the browser.
export async function signInDemo(): Promise<AuthState> {
  const parsed = Credentials.safeParse({ email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD });
  if (!parsed.success) return { error: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: GENERIC_ERROR };

  redirect("/app");
}
