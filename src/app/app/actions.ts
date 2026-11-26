"use server";

import { redirect } from "next/navigation";
import { GENERIC_ERROR } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type SignOutState = { error: string } | null;

// scope "local" closes only this browser's session: the demo account is shared, and the default
// ("global") would sign every visitor out.
export async function signOut(): Promise<SignOutState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) return { error: GENERIC_ERROR };

  redirect("/login");
}
