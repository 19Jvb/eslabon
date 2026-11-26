"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Saves the browser's zone for the server's «today» (IANA names are cookie-safe) and, when it was
// missing or has changed, re-renders once so the page shows the user's day without a manual reload.
export function TimeZoneCookie() {
  const router = useRouter();

  useEffect(() => {
    const cookie = `tz=${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    if (document.cookie.split("; ").includes(cookie)) return;
    document.cookie = `${cookie}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);

  return null;
}
