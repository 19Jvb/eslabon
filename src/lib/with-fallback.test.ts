import { redirect } from "next/navigation";
import { describe, expect, it } from "vitest";
import { withFallback } from "./with-fallback";

const FALLBACK = { error: "No se pudo completar. Inténtalo de nuevo." };

describe("withFallback", () => {
  it("returns the action's own result and forwards its arguments", async () => {
    const action = async (prev: number, input: string) => ({ error: `${prev}:${input}` });
    await expect(withFallback(action, FALLBACK)(1, "a")).resolves.toEqual({ error: "1:a" });
  });

  it("returns the fallback when the call fails (500 or network down)", async () => {
    const action = async (): Promise<typeof FALLBACK> => {
      throw new Error("An unexpected response was received from the server.");
    };
    await expect(withFallback(action, FALLBACK)()).resolves.toBe(FALLBACK);
  });

  it("rethrows the redirect of a successful action so Next can navigate", async () => {
    const action = async (): Promise<typeof FALLBACK> => redirect("/app");
    await expect(withFallback(action, FALLBACK)()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});
