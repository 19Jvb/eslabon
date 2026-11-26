import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { SignOutForm } from "./sign-out-form";
import { TimeZoneCookie } from "./time-zone-cookie";

// The session check lives here so every route under /app gets it.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-lg font-bold text-emerald-800">Eslabón</span>
          <Suspense fallback={<span className="text-sm text-neutral-600">Cargando…</span>}>
            <Account />
          </Suspense>
        </div>
      </header>
      {children}
      <TimeZoneCookie />
    </div>
  );
}

// Request-time only (behind <Suspense>): connection() keeps it out of the runtime prefetch,
// where cookies() resolves but Supabase's token-expiry check may not read the current time.
async function Account() {
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="truncate text-sm text-neutral-700">{user.email}</span>
      <SignOutForm />
    </div>
  );
}
