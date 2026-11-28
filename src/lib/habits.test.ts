import { describe, expect, it } from "vitest";
import { CheckIn, COLOR_IDS, HABIT_COLORS, habitColor, HabitRef, habitErrorMessage, historyHabitId, NewHabit, RenameHabit } from "./habits";

const ID = "3f1c2a7e-9b4d-4e2a-8c1f-5d6e7f809a1b";
const firstMessage = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0].message;

describe("palette", () => {
  it("lists the six colors in order, with the ids the DB accepts and Spanish labels", () => {
    expect(COLOR_IDS).toEqual(["red", "orange", "amber", "green", "blue", "violet"]);
    expect(COLOR_IDS.map((id) => HABIT_COLORS[id].label)).toEqual(["Rojo", "Naranja", "Ámbar", "Verde", "Azul", "Violeta"]);
  });

  it("maps each color to its classes and an unknown one to a neutral palette", () => {
    expect(habitColor("red")).toBe(HABIT_COLORS.red);
    expect(habitColor("blue").done).toBe("border-blue-600 bg-blue-600");
    expect(habitColor("pink").swatch).toBe("bg-neutral-500");
    expect(habitColor("toString").swatch).toBe("bg-neutral-500");
  });

  it("writes every class literally, in the color it belongs to (Tailwind only sees full class names)", () => {
    for (const id of COLOR_IDS) {
      const { swatch, pressed, done } = HABIT_COLORS[id];
      for (const cls of `${swatch} ${pressed} ${done}`.split(" ")) expect(cls).toContain(`-${id}-`);
    }
  });
});

describe("NewHabit", () => {
  it("trims the name and accepts a palette color", () => {
    expect(NewHabit.parse({ name: "  Leer  ", color: "blue" })).toEqual({ name: "Leer", color: "blue" });
  });

  it.each(["", "   ", "\t\n"])("rejects an empty or blank name (%j)", (name) => {
    expect(firstMessage(NewHabit.safeParse({ name, color: "green" }))).toBe("Escribe un nombre");
  });

  it("rejects a missing name instead of throwing", () => {
    expect(firstMessage(NewHabit.safeParse({ color: "green" }))).toBe("Escribe un nombre");
    expect(NewHabit.safeParse(undefined).success).toBe(false);
  });

  it("accepts 60 characters (also after trimming) and rejects 61", () => {
    expect(NewHabit.safeParse({ name: "x".repeat(60), color: "green" }).success).toBe(true);
    expect(NewHabit.safeParse({ name: ` ${"x".repeat(60)} `, color: "green" }).success).toBe(true);
    expect(firstMessage(NewHabit.safeParse({ name: "x".repeat(61), color: "green" }))).toBe("Máximo 60 caracteres");
  });

  it.each(["pink", "", undefined, "Verde"])("rejects a color outside the palette (%j) with a Spanish message", (color) => {
    expect(firstMessage(NewHabit.safeParse({ name: "Leer", color }))).toBe("Elige un color");
  });
});

describe("RenameHabit and HabitRef", () => {
  it("accepts a uuid and a valid name", () => {
    expect(RenameHabit.parse({ id: ID, name: " Correr " })).toEqual({ id: ID, name: "Correr" });
    expect(HabitRef.parse({ id: ID })).toEqual({ id: ID });
  });

  it("applies the same name rules as NewHabit", () => {
    expect(firstMessage(RenameHabit.safeParse({ id: ID, name: "  " }))).toBe("Escribe un nombre");
    expect(firstMessage(RenameHabit.safeParse({ id: ID, name: "x".repeat(61) }))).toBe("Máximo 60 caracteres");
  });

  it.each(["1", "", undefined, `${ID}x`])("rejects an id that is not a uuid (%j) with the generic message", (id) => {
    expect(firstMessage(RenameHabit.safeParse({ id, name: "Correr" }))).toBe("No se pudo completar. Inténtalo de nuevo.");
    expect(firstMessage(HabitRef.safeParse({ id }))).toBe("No se pudo completar. Inténtalo de nuevo.");
  });
});

describe("CheckIn", () => {
  it("accepts a habit id, a day and the intent (mark or unmark)", () => {
    expect(CheckIn.parse({ habitId: ID, day: "2026-11-26", done: true })).toEqual({ habitId: ID, day: "2026-11-26", done: true });
    expect(CheckIn.parse({ habitId: ID, day: "2026-11-26", done: false }).done).toBe(false);
  });

  it.each([
    { habitId: "1", day: "2026-11-26", done: true },
    { habitId: ID, day: 20261126, done: true },
    { habitId: ID, day: "2026-11-26", done: "true" },
    { habitId: ID, day: "2026-11-26" },
  ])("rejects %j with the generic message", (input) => {
    expect(firstMessage(CheckIn.safeParse(input))).toBe("No se pudo completar. Inténtalo de nuevo.");
  });
});

describe("input that is not an object", () => {
  it.each([undefined, null, "x", 42, []])("answers %j with the generic Spanish message", (input) => {
    for (const schema of [NewHabit, RenameHabit, HabitRef, CheckIn]) {
      expect(firstMessage(schema.safeParse(input))).toBe("No se pudo completar. Inténtalo de nuevo.");
    }
  });
});

describe("habitErrorMessage", () => {
  it("turns the unique violation (23505) into the duplicate message", () => {
    expect(habitErrorMessage("23505")).toBe("Ya tienes un hábito con ese nombre.");
  });

  it.each(["42501", "23514", "PGRST116", undefined])("falls back to the generic message for %s", (code) => {
    expect(habitErrorMessage(code)).toBe("No se pudo completar. Inténtalo de nuevo.");
  });
});

describe("historyHabitId", () => {
  it("is the segment after /app/habitos/, whatever it is (the proxy checks it)", () => {
    expect(historyHabitId(`/app/habitos/${ID}`)).toBe(ID);
    expect(historyHabitId("/app/habitos/no-es-un-uuid")).toBe("no-es-un-uuid");
  });

  it("is null on any other path", () => {
    for (const path of ["/app", "/app/habitos", "/app/habitos/", `/app/habitos/${ID}/x`, `/habitos/${ID}`, `/x/app/habitos/${ID}`]) {
      expect(historyHabitId(path), path).toBeNull();
    }
  });
});
