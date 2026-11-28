import { describe, expect, it } from "vitest";
import { botUsername, telegramApiBase, telegramStartLink } from "@/lib/telegram";

describe("telegramStartLink", () => {
  it("el enlace profundo del bot con el código en start", () => {
    expect(telegramStartLink("EslabonHabitsBot", "AB12CD34")).toBe("https://t.me/EslabonHabitsBot?start=AB12CD34");
  });
});

describe("botUsername", () => {
  it("deja el usuario tal cual si ya está limpio", () => {
    expect(botUsername("EslabonHabitsBot")).toBe("EslabonHabitsBot");
  });

  it("quita los espacios y la @ inicial", () => {
    expect(botUsername("  @EslabonHabitsBot \n")).toBe("EslabonHabitsBot");
    expect(botUsername("@EslabonHabitsBot")).toBe("EslabonHabitsBot");
  });

  it("vacío si falta o solo hay espacios o la @", () => {
    expect(botUsername(undefined)).toBe("");
    expect(botUsername("   ")).toBe("");
    expect(botUsername(" @ ")).toBe("");
  });
});

describe("telegramApiBase", () => {
  const simulator = "http://127.0.0.1:4545";

  it("en producción es siempre la API de Telegram, aunque haya TELEGRAM_API_BASE", () => {
    expect(telegramApiBase({ VERCEL_ENV: "production", TELEGRAM_API_BASE: simulator })).toBe("https://api.telegram.org");
    expect(telegramApiBase({ VERCEL_ENV: "production" })).toBe("https://api.telegram.org");
  });

  it("fuera de producción (preview, local) usa TELEGRAM_API_BASE si está", () => {
    expect(telegramApiBase({ VERCEL_ENV: "preview", TELEGRAM_API_BASE: simulator })).toBe(simulator);
    expect(telegramApiBase({ TELEGRAM_API_BASE: simulator })).toBe(simulator);
  });

  it("sin TELEGRAM_API_BASE, o vacía, la API de Telegram", () => {
    expect(telegramApiBase({})).toBe("https://api.telegram.org");
    expect(telegramApiBase({ VERCEL_ENV: "development", TELEGRAM_API_BASE: "" })).toBe("https://api.telegram.org");
  });
});
