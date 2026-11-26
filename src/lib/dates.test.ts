import { describe, expect, it } from "vitest";
import { addDays, isEditableDay, isValidDay, todayIn } from "@/lib/dates";

describe("todayIn", () => {
  it("devuelve el día local en formato YYYY-MM-DD", () => {
    expect(todayIn("Europe/Madrid", new Date("2026-06-15T10:00:00Z"))).toBe("2026-06-15");
  });

  it("UTC y Pacific/Honolulu (UTC−10) dan días distintos en el mismo instante", () => {
    const now = new Date("2026-06-01T05:00:00Z");
    expect(todayIn("UTC", now)).toBe("2026-06-01");
    expect(todayIn("Pacific/Honolulu", now)).toBe("2026-05-31");
  });

  it("el usuario de Madrid ya está en el día siguiente aunque en UTC no", () => {
    expect(todayIn("Europe/Madrid", new Date("2026-01-31T23:30:00Z"))).toBe("2026-02-01");
    expect(todayIn("Europe/Madrid", new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("acierta el día alrededor del cambio a horario de verano en Madrid (2026-03-29)", () => {
    expect(todayIn("Europe/Madrid", new Date("2026-03-28T22:59:00Z"))).toBe("2026-03-28");
    expect(todayIn("Europe/Madrid", new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-29");
    expect(todayIn("Europe/Madrid", new Date("2026-03-29T21:59:00Z"))).toBe("2026-03-29");
    expect(todayIn("Europe/Madrid", new Date("2026-03-29T22:30:00Z"))).toBe("2026-03-30");
  });

  it("acierta el día alrededor del cambio a horario de invierno en Madrid (2026-10-25)", () => {
    expect(todayIn("Europe/Madrid", new Date("2026-10-24T21:59:00Z"))).toBe("2026-10-24");
    expect(todayIn("Europe/Madrid", new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(todayIn("Europe/Madrid", new Date("2026-10-25T22:59:00Z"))).toBe("2026-10-25");
    expect(todayIn("Europe/Madrid", new Date("2026-10-25T23:00:00Z"))).toBe("2026-10-26");
  });

  it("si la zona no es válida usa Europe/Madrid sin lanzar error", () => {
    const now = new Date("2026-03-28T23:30:00Z");
    expect(todayIn("Marte/Base", now)).toBe("2026-03-29");
    expect(todayIn("", now)).toBe("2026-03-29");
  });

  it("sin now usa el instante actual y devuelve un día válido", () => {
    expect(isValidDay(todayIn("UTC"))).toBe(true);
  });
});

describe("addDays", () => {
  it("cruza el fin de mes (31 → 1)", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-02-01", -1)).toBe("2026-01-31");
  });

  it("cruza el fin de año (31-12 → 01-01)", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("incluye el 29 de febrero en un año bisiesto (2028) y lo salta en uno normal", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("no se ve afectado por los cambios de horario de Madrid", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-10-26", -1)).toBe("2026-10-25");
  });

  it("acepta 0 y saltos largos", () => {
    expect(addDays("2026-05-10", 0)).toBe("2026-05-10");
    expect(addDays("2026-01-01", 365)).toBe("2027-01-01");
    expect(addDays("2028-01-01", 366)).toBe("2029-01-01");
  });
});

describe("isValidDay", () => {
  it("acepta fechas reales con el formato exacto", () => {
    expect(isValidDay("2026-01-01")).toBe(true);
    expect(isValidDay("2028-02-29")).toBe(true);
    expect(isValidDay("2026-12-31")).toBe(true);
  });

  it("rechaza fechas que no existen", () => {
    expect(isValidDay("2025-02-29")).toBe(false);
    expect(isValidDay("2026-13-01")).toBe(false);
    expect(isValidDay("2026-00-10")).toBe(false);
    expect(isValidDay("2026-04-31")).toBe(false);
    expect(isValidDay("2026-01-00")).toBe(false);
  });

  it("rechaza cualquier otro formato", () => {
    for (const s of ["", "2026-1-01", "2026-01-1", "26-01-01", "2026/01/01", "2026-01-01T00:00:00Z", " 2026-01-01", "2026-01-01 ", "abcd-ef-gh"]) {
      expect(isValidDay(s), s).toBe(false);
    }
  });
});

describe("isEditableDay", () => {
  const today = "2026-03-03";

  it("permite hoy y los 6 días anteriores, también cruzando el mes", () => {
    expect(isEditableDay(today, today)).toBe(true);
    expect(isEditableDay("2026-03-01", today)).toBe(true);
    expect(isEditableDay("2026-02-25", today)).toBe(true);
  });

  it("rechaza el séptimo día hacia atrás y anteriores", () => {
    expect(isEditableDay("2026-02-24", today)).toBe(false);
    expect(isEditableDay("2025-03-03", today)).toBe(false);
  });

  it("rechaza los días futuros", () => {
    expect(isEditableDay("2026-03-04", today)).toBe(false);
    expect(isEditableDay("2027-01-01", today)).toBe(false);
  });

  it("rechaza los días malformados o inexistentes", () => {
    expect(isEditableDay("2026-3-1", today)).toBe(false);
    expect(isEditableDay("2026-02-30", today)).toBe(false);
    expect(isEditableDay("", today)).toBe(false);
  });

  it("cruza el fin de año", () => {
    expect(isEditableDay("2026-12-27", "2027-01-02")).toBe(true);
    expect(isEditableDay("2026-12-26", "2027-01-02")).toBe(false);
  });
});
