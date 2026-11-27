import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// Compiles the matcher with the same function Next uses for the build manifest.
function runsProxy(path: string): boolean {
  return config.matcher.some((source) => {
    const { regexStr } = tryToParsePath(source);
    if (!regexStr) throw new Error(`Invalid matcher: ${source}`);
    return new RegExp(regexStr).test(path);
  });
}

describe("proxy matcher", () => {
  it.each(["/", "/app", "/login", "/app/medico", "/app/habitos/xpng", "/favicon-ico"])(
    "refreshes the session on %s",
    (path) => expect(runsProxy(path)).toBe(true),
  );

  it.each(["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/logo.png", "/img/a.webp"])(
    "skips static file %s",
    (path) => expect(runsProxy(path)).toBe(false),
  );

  // Telegram calls the webhook without cookies: there is no session to refresh.
  it("skips the Telegram webhook", () => expect(runsProxy("/api/telegram/webhook")).toBe(false));
});
