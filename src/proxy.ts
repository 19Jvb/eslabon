import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";

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
    if (isApp && !user) return redirectWithSession("/login", request, response, cacheHeaders);
    if (isAuthPage && user) return redirectWithSession("/app", request, response, cacheHeaders);
  }

  return response;
}

// Fixed internal targets only (no ?next=), carrying any refreshed session cookies and their anti-cache headers.
function redirectWithSession(
  path: "/login" | "/app",
  request: NextRequest,
  response: NextResponse,
  cacheHeaders: Record<string, string>,
) {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  Object.entries(cacheHeaders).forEach(([key, value]) => redirect.headers.set(key, value));
  return redirect;
}

// Static files and the Telegram webhook (no cookies, no session) skip the proxy.
export const config = {
  matcher: ["/((?!_next/static|_next/image|api/telegram/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
