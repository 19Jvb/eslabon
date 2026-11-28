import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";
import { HabitRef, historyHabitId } from "@/lib/habits";

// A static page that calls notFound(): see the history check below.
const MISSING_HABIT_PATH = "/habito-no-encontrado";

// Refreshes the Supabase session on every request and forwards the updated cookies.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Anti-cache headers @supabase/ssr sends with refreshed cookies: they must reach any response that sets them.
  let cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          cacheHeaders = headers;
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only page loads are redirected: a Server Action POST must reach its handler.
  if (request.method === "GET") {
    const { pathname } = request.nextUrl;
    const isApp = pathname === "/app" || pathname.startsWith("/app/");
    const isAuthPage = pathname === "/login" || pathname === "/registro";
    if (isApp && !user) return withSession(NextResponse.redirect(new URL("/login", request.url)), response, cacheHeaders);
    if (isAuthPage && user) return withSession(NextResponse.redirect(new URL("/app", request.url)), response, cacheHeaders);

    // With Cache Components the page sends its shell before it can read the habit, so a notFound() there answers 200.
    // A habit that is not a uuid, does not exist or is someone else's (RLS hides it) is told apart here, before any
    // rendering: the same 404 for the three. A failed query lets the page show its error instead.
    const habitId = historyHabitId(pathname);
    if (user && habitId !== null) {
      const lookup = HabitRef.safeParse({ id: habitId }).success
        ? await supabase.from("habits").select("id").eq("id", habitId).maybeSingle()
        : { data: null, error: null };
      if (!lookup.error && !lookup.data) {
        const missing = NextResponse.rewrite(new URL(MISSING_HABIT_PATH, request.url), { request });
        return withSession(missing, response, cacheHeaders);
      }
    }
  }

  return response;
}

// Redirects and rewrites go to fixed internal paths only (no ?next=), with any refreshed session cookies and their
// anti-cache headers.
function withSession(target: NextResponse, response: NextResponse, cacheHeaders: Record<string, string>) {
  response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  Object.entries(cacheHeaders).forEach(([key, value]) => target.headers.set(key, value));
  return target;
}

// Static files (images, the manifest and its icons, the apple-touch-icon) and the Telegram webhook (no cookies, no
// session) skip the proxy.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|api/telegram/|favicon\\.ico|manifest\\.webmanifest$|apple-icon$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
