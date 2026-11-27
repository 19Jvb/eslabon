import { describe, expect, it } from "vitest";
import { botUsername, telegramStartLink } from "@/lib/telegram";

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
