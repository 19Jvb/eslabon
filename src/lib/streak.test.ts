import { describe, expect, it } from "vitest";
import { bestStreak, completionRate, currentStreak, heatmapWeeks } from "@/lib/streak";

describe("currentStreak", () => {
  it("vale 0 con el conjunto vacío", () => {
    expect(currentStreak([], "2026-05-10")).toBe(0);
  });

  it("cuenta hacia atrás desde hoy si hoy está marcado", () => {
    expect(currentStreak(["2026-05-08", "2026-05-09", "2026-05-10"], "2026-05-10")).toBe(3);
  });

  it("si hoy no está marcado, la racha que viene de ayer sigue viva", () => {
    expect(currentStreak(["2026-05-08", "2026-05-09"], "2026-05-10")).toBe(2);
  });

  it("se rompe si falta ayer y hoy", () => {
    expect(currentStreak(["2026-05-07", "2026-05-08"], "2026-05-10")).toBe(0);
  });

  it("se corta en el primer hueco", () => {
    expect(currentStreak(["2026-05-05", "2026-05-07", "2026-05-08", "2026-05-09", "2026-05-10"], "2026-05-10")).toBe(4);
  });

  it("ignora duplicados y desorden", () => {
    expect(currentStreak(["2026-05-10", "2026-05-08", "2026-05-09", "2026-05-10", "2026-05-08"], "2026-05-10")).toBe(3);
  });

  it("ignora los días futuros", () => {
    expect(currentStreak(["2026-05-11", "2026-05-12"], "2026-05-10")).toBe(0);
    expect(currentStreak(["2026-05-09", "2026-05-10", "2026-05-11"], "2026-05-10")).toBe(2);
  });

  it("acepta un Set", () => {
    expect(currentStreak(new Set(["2026-05-09", "2026-05-10"]), "2026-05-10")).toBe(2);
  });

  it("cruza fin de mes, fin de año y el 29 de febrero", () => {
    expect(currentStreak(["2026-01-30", "2026-01-31", "2026-02-01"], "2026-02-01")).toBe(3);
    expect(currentStreak(["2026-12-30", "2026-12-31", "2027-01-01"], "2027-01-01")).toBe(3);
    expect(currentStreak(["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01")).toBe(3);
    expect(currentStreak(["2026-02-28", "2026-03-01"], "2026-03-01")).toBe(2);
  });

  it("no se rompe al cruzar los cambios de horario de Madrid", () => {
    expect(currentStreak(["2026-03-28", "2026-03-29", "2026-03-30"], "2026-03-30")).toBe(3);
    expect(currentStreak(["2026-10-24", "2026-10-25", "2026-10-26"], "2026-10-26")).toBe(3);
  });
});

describe("bestStreak", () => {
  it("vale 0 con el conjunto vacío", () => {
    expect(bestStreak([])).toBe(0);
  });

  it("vale 1 con un solo día", () => {
    expect(bestStreak(["2026-05-10"])).toBe(1);
  });

  it("devuelve la racha más larga aunque no sea la última", () => {
    expect(bestStreak(["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-05", "2026-05-06"])).toBe(3);
  });

  it("ignora duplicados y desorden", () => {
    expect(bestStreak(["2026-05-06", "2026-05-02", "2026-05-01", "2026-05-02", "2026-05-05", "2026-05-03", "2026-05-01"])).toBe(3);
  });

  it("cruza fin de mes, fin de año, el 29 de febrero y los cambios de horario", () => {
    expect(bestStreak(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"])).toBe(4);
    expect(bestStreak(["2028-02-28", "2028-02-29", "2028-03-01"])).toBe(3);
    expect(bestStreak(["2026-02-28", "2026-03-01"])).toBe(2);
    expect(bestStreak(["2026-03-28", "2026-03-29", "2026-03-30", "2026-10-25", "2026-10-26"])).toBe(3);
  });
});

describe("completionRate", () => {
  const today = "2026-05-30";

  it("vale 0 con el conjunto vacío", () => {
    expect(completionRate([], today)).toBe(0);
  });

  it("vale 100 con los 30 días de la ventana marcados", () => {
    const days = Array.from({ length: 30 }, (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`);
    expect(completionRate(days, today)).toBe(100);
  });

  it("es un porcentaje entero redondeado", () => {
    expect(completionRate(["2026-05-30"], today)).toBe(3);
    expect(completionRate(["2026-05-29", "2026-05-30"], today)).toBe(7);
  });

  it("solo cuentan los días de la ventana [hoy−29, hoy]", () => {
    expect(completionRate(["2026-05-01"], today)).toBe(3);
    expect(completionRate(["2026-04-30", "2026-04-01"], today)).toBe(0);
    expect(completionRate(["2026-05-31", "2026-06-15"], today)).toBe(0);
  });

  it("los duplicados no cuentan doble", () => {
    expect(completionRate(["2026-05-30", "2026-05-30", "2026-05-30"], today)).toBe(3);
  });

  it("respeta windowDays", () => {
    expect(completionRate(["2026-05-29", "2026-05-30"], today, 4)).toBe(50);
  });

  it("cruza el 29 de febrero de 2028", () => {
    expect(completionRate(["2028-02-01", "2028-02-29"], "2028-03-01")).toBe(7);
    expect(completionRate(["2028-01-31"], "2028-03-01")).toBe(0);
  });
});

describe("heatmapWeeks", () => {
  const today = "2026-11-26"; // jueves

  it("devuelve exactamente 12 semanas de 7 días por defecto", () => {
    const weeks = heatmapWeeks([], today);
    expect(weeks).toHaveLength(12);
    for (const week of weeks) expect(week).toHaveLength(7);
  });

  it("empieza en lunes, acaba en domingo y la última semana es la de hoy", () => {
    const weeks = heatmapWeeks([], today);
    expect(weeks[0][0].day).toBe("2026-09-07");
    expect(weeks[11][0].day).toBe("2026-11-23");
    expect(weeks[11][3].day).toBe(today);
    expect(weeks[11][6].day).toBe("2026-11-29");
  });

  it("los días son consecutivos sin huecos", () => {
    const flat = heatmapWeeks([], today).flat().map((c) => c.day);
    expect(new Set(flat).size).toBe(84);
    expect([...flat].sort()).toEqual(flat);
  });

  it("marca done los días del conjunto y future los posteriores a hoy", () => {
    const week = heatmapWeeks(["2026-11-24", "2026-11-26", "2026-11-24"], today)[11];
    expect(week.map((c) => c.done)).toEqual([false, true, false, true, false, false, false]);
    expect(week.map((c) => c.future)).toEqual([false, false, false, false, true, true, true]);
  });

  it("un día futuro marcado se ignora (no sale como hecho)", () => {
    const week = heatmapWeeks(["2026-11-27"], today)[11];
    expect(week[4]).toEqual({ day: "2026-11-27", done: false, future: true });
  });

  it("si hoy es domingo, hoy es la última celda; si es lunes, la primera de la última semana", () => {
    expect(heatmapWeeks([], "2026-11-29")[11][6]).toEqual({ day: "2026-11-29", done: false, future: false });
    expect(heatmapWeeks([], "2026-11-30")[11][0]).toEqual({ day: "2026-11-30", done: false, future: false });
  });

  it("respeta el número de semanas y cruza el fin de año", () => {
    const weeks = heatmapWeeks(["2026-12-31", "2027-01-01"], "2027-01-01", 2);
    expect(weeks).toHaveLength(2);
    expect(weeks[0][0].day).toBe("2026-12-21");
    expect(weeks[1][0].day).toBe("2026-12-28");
    expect(weeks[1].filter((c) => c.done).map((c) => c.day)).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("cruza los cambios de horario sin repetir ni saltar días", () => {
    const flat = heatmapWeeks([], "2026-11-01", 12).flat().map((c) => c.day);
    expect(flat).toContain("2026-10-25");
    expect(flat).toContain("2026-10-26");
    expect(new Set(flat).size).toBe(84);
  });
});
