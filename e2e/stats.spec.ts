import { expect, type Page } from "@playwright/test";
import { addDays } from "../src/lib/dates";
import { bestStreak, completionRate, currentStreak, heatmapWeeks } from "../src/lib/streak";
import {
  GENERIC,
  MADRID,
  alert,
  cleanUp,
  dayAt,
  dayButton,
  expectFitsMobile,
  expectNoSeriousA11yViolations,
  failServerActions,
  item,
  mark,
  marked,
  openApp,
  prefix,
  seed,
  shownToday,
  tabTo,
  test,
  tooLong,
} from "./helpers";

// T08: estadísticas y mapa de calor de 12 semanas, con el usuario de E2E y el navegador en Madrid.
// Los valores esperados salen de src/lib/streak.ts (aprobada en T03) con el «hoy» que pinta la app (data-day de «Hoy»)
// y los días que hay de verdad en la BD: así el test no duplica la lógica y no falla en falso si cruza la medianoche.
// Límite de los datos: la RLS de check_ins solo deja insertar entre current_date−8 y current_date+1 (UTC), así que el
// historial sembrado va de hoy−8 a hoy. Los historiales largos (mejor racha fuera de los 30 días, el mapa con semanas
// antiguas) se prueban en T09, cuando exista «Cargar datos de ejemplo».
// Riesgo de medianoche: si la zona cambia de día entre sembrar y pintar, el escenario cambia de sentido (el «hoy»
// sembrado pasa a ser «ayer»), pero lo esperado se recalcula con el «hoy» pintado y el test sigue siendo correcto.

const GONE = "Ese hábito ya no existe.";
const TERMS = ["Racha actual", "Mejor racha", "Últimos 30 días"];

test.use({ timezoneId: MADRID });

test.afterEach(async ({ api }) => {
  await cleanUp(api);
});

const days = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

/** Lo que tiene que decir la <dl> para esos días marcados y ese «hoy». */
const expectedStats = (marks: string[], today: string) => ({
  "Racha actual": days(currentStreak(marks, today)),
  "Mejor racha": days(bestStreak(marks)),
  "Últimos 30 días": `${completionRate(marks, today)} %`,
});

/** Los pares <dt>/<dd> de cada <dl> del hábito (tiene que haber una), con los espacios normalizados (vale el espacio duro). */
const readStats = (page: Page, habit: string) =>
  item(page, habit)
    .locator("dl")
    .evaluateAll((dls) =>
      dls.map((dl) =>
        [...dl.querySelectorAll("dt")].map((dt) => {
          const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
          const dd = dt.nextElementSibling?.tagName === "DD" ? dt.nextElementSibling.textContent : null;
          return [clean(dt.textContent), clean(dd)];
        }),
      ),
    );

async function expectStats(page: Page, habit: string, marks: string[], today: string) {
  const expected = expectedStats(marks, today);
  await expect
    .poll(() => readStats(page, habit), { message: `una <dl> con las estadísticas de «${habit}»` })
    .toEqual([Object.entries(expected)]);
}

const heatmap = (page: Page, habit: string) =>
  item(page, habit).getByRole("img", { name: /^Historial de 12 semanas de / });

/**
 * El mapa: role="img" con «Historial de 12 semanas de <hábito>: N de M días cumplidos», 84 celdas [data-day] ocultas
 * (aria-hidden) en 12 columnas (semanas, la última la de hoy) × 7 filas (lunes a domingo), con data-done y data-future.
 */
async function expectHeatmap(page: Page, habit: string, marks: string[], today: string) {
  const grid = heatmapWeeks(marks, today);
  const flat = grid.flat();
  const done = flat.filter((c) => c.done).length;
  const past = flat.filter((c) => !c.future).length;
  const heat = heatmap(page, habit);
  await expect(heat, `mapa de «${habit}»`).toHaveCount(1);
  await expect(heat).toHaveAccessibleName(`Historial de 12 semanas de ${habit}: ${done} de ${past} días cumplidos`);

  const readCells = () =>
    heat.locator("[data-day]").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const hidden = el.closest('[aria-hidden="true"]');
        const img = el.closest('[role="img"]');
        return {
          day: el.getAttribute("data-day"),
          done: el.getAttribute("data-done"),
          future: el.getAttribute("data-future"),
          hidden: hidden !== null && img !== null && img.contains(hidden),
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          w: r.width,
          h: r.height,
        };
      }),
    );
  const states = (cells: Awaited<ReturnType<typeof readCells>>) =>
    cells.map((c) => `${c.day} done=${c.done} future=${c.future === "true"} hidden=${c.hidden}`).sort();
  const expected = flat.map((c) => `${c.day} done=${c.done} future=${c.future} hidden=true`).sort();
  await expect.poll(async () => states(await readCells()), { message: `celdas de «${habit}»` }).toEqual(expected);

  const byDay = new Map((await readCells()).map((c) => [c.day, c]));
  const at = (w: number, d: number) => byDay.get(grid[w][d].day)!;
  for (const c of byDay.values()) expect(c.w > 0 && c.h > 0, `la celda ${c.day} se ve`).toBe(true);
  for (let w = 0; w < 12; w++) {
    for (let d = 0; d < 7; d++) {
      const cell = at(w, d);
      expect(Math.abs(cell.x - at(w, 0).x), `${cell.day}: en la columna de su semana`).toBeLessThan(1);
      expect(Math.abs(cell.y - at(0, d).y), `${cell.day}: en la fila de su día de la semana`).toBeLessThan(1);
      if (w > 0) expect(cell.x, `${cell.day}: semana a la derecha de la anterior`).toBeGreaterThan(at(w - 1, d).x);
      if (d > 0) expect(cell.y, `${cell.day}: debajo del día anterior`).toBeGreaterThan(at(w, d - 1).y);
    }
  }
}

/** Siembra un hábito con días relativos a hoy (Madrid), abre /app y devuelve el «hoy» pintado y los días de la BD. */
async function seedAndOpen(page: Page, api: Parameters<typeof mark>[0], habit: string, offsets: number[]) {
  const [id] = await seed(api, { name: habit });
  const today = dayAt(MADRID, new Date());
  if (offsets.length) await mark(api, id, ...offsets.map((n) => addDays(today, n)));
  await openApp(page);
  return { id, today: await shownToday(page, habit, MADRID), marks: await marked(api, id) };
}

// Escenarios dentro de la ventana que permite la RLS (hoy−8 … hoy). Lo esperado está escrito para leerlo y se
// contrasta con streak.ts sobre el día sembrado; la UI se compara con streak.ts sobre el día pintado.
const SCENARIOS = [
  { name: "racha actual con hoy marcado", offsets: [-2, -1, 0], stats: ["3 días", "3 días", "10 %"] },
  { name: "hoy sin marcar y ayer sí: la racha sigue viva", offsets: [-3, -2, -1], stats: ["3 días", "3 días", "10 %"] },
  { name: "racha rota (ni hoy ni ayer)", offsets: [-5, -4, -2], stats: ["0 días", "2 días", "10 %"] },
  { name: "mejor racha mayor que la actual (hoy−8…hoy−4, hueco, ayer y hoy)", offsets: [-8, -7, -6, -5, -4, -1, 0], stats: ["2 días", "5 días", "23 %"] },
  { name: "singular: solo hoy", offsets: [0], stats: ["1 día", "1 día", "3 %"] },
] as const;

test.describe("estadísticas y mapa con historial (hoy−8 … hoy)", () => {
  for (const s of SCENARIOS) {
    test(`${s.name} → «${s.stats.join("», «")}» en la <dl> y esos días con data-done=true en el mapa`, async ({ page, api }) => {
      const seededToday = dayAt(MADRID, new Date());
      const seeded = s.offsets.map((n) => addDays(seededToday, n));
      expect(Object.values(expectedStats(seeded, seededToday)), "el escenario está bien escrito").toEqual(s.stats);

      const habit = `${prefix()}-stats`;
      const { today, marks } = await seedAndOpen(page, api, habit, [...s.offsets]);
      await expectStats(page, habit, marks, today);
      await expectHeatmap(page, habit, marks, today);
    });
  }

  test("D-13: un hábito sin días marcados → «0 días», «0 días», «0 %» y el mapa sin ningún día cumplido", async ({ page, api }) => {
    const habit = `${prefix()}-vacio`;
    const { today, marks } = await seedAndOpen(page, api, habit, []);
    expect(marks).toEqual([]);
    await expect.poll(() => readStats(page, habit), "una <dl> con todo a cero").toEqual([
      [
        [TERMS[0], "0 días"],
        [TERMS[1], "0 días"],
        [TERMS[2], "0 %"],
      ],
    ]);
    await expectHeatmap(page, habit, marks, today);
  });

  test("el mapa: la última columna es la semana de hoy, los días después de hoy van con data-future=true y no cuentan en M", async ({ page, api }) => {
    const habit = `${prefix()}-futuro`;
    const { today, marks } = await seedAndOpen(page, api, habit, [0]);
    const cells = heatmap(page, habit).locator("[data-day]");
    const last = heatmapWeeks(marks, today)[11];
    expect(last.map((c) => c.day), "la semana de hoy").toContain(today);
    await expect(cells.and(page.locator(`[data-day="${today}"]`))).toHaveAttribute("data-done", "true");
    await expect(cells.and(page.locator('[data-future="true"]'))).toHaveCount(last.filter((c) => c.future).length);
    await expectHeatmap(page, habit, marks, today);
  });

  test("WCAG 1.4.1: una celda cumplida y una no cumplida se distinguen por algo más que el color (borde, relleno, forma o contenido)", async ({ page, api }) => {
    const habit = `${prefix()}-color`;
    const { today } = await seedAndOpen(page, api, habit, [0]);
    const cells = heatmap(page, habit).locator("[data-day]");
    const look = (day: string) =>
      cells.and(page.locator(`[data-day="${day}"]`)).evaluate((el) => {
        const alpha = (c: string) => {
          if (c === "transparent") return 0;
          const slash = c.match(/\/\s*([\d.]+)(%?)\s*\)$/);
          if (slash) return parseFloat(slash[1]) / (slash[2] ? 100 : 1);
          const rgba = c.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
          return rgba ? parseFloat(rgba[1]) : 1;
        };
        const s = getComputedStyle(el);
        // Solo lo que no es color: grosor y estilo del borde y del contorno, relleno sí/no, sombra sí/no, imagen,
        // contenido de ::before/::after, hijos y tamaño.
        return {
          border: ["Top", "Right", "Bottom", "Left"].map((side) => {
            const style = s.getPropertyValue(`border-${side.toLowerCase()}-style`);
            return style === "none" || style === "hidden" ? "none" : `${s.getPropertyValue(`border-${side.toLowerCase()}-width`)} ${style}`;
          }),
          outline: s.outlineStyle === "none" ? "none" : `${s.outlineWidth} ${s.outlineStyle}`,
          filled: alpha(s.backgroundColor) > 0,
          shadow: s.boxShadow !== "none",
          image: s.backgroundImage,
          before: getComputedStyle(el, "::before").content,
          after: getComputedStyle(el, "::after").content,
          children: el.innerHTML,
          size: `${(el as HTMLElement).offsetWidth}x${(el as HTMLElement).offsetHeight}`,
        };
      });
    expect(await look(today), "hoy (cumplido) frente a ayer (no cumplido)").not.toEqual(await look(addDays(today, -1)));
  });
});

test.describe("al marcar y desmarcar", () => {
  test("las estadísticas y el mapa se actualizan sin recargar (Hoy, Ayer y desmarcar Hoy)", async ({ page, api }) => {
    const habit = `${prefix()}-vivo`;
    const { id, today } = await seedAndOpen(page, api, habit, []);
    await page.evaluate(() => Object.assign(window, { e2eSinRecarga: true }));
    const yesterday = addDays(today, -1);

    for (const [tag, after] of [
      ["Hoy", [today]],
      ["Ayer", [yesterday, today]],
      ["Hoy", [yesterday]],
    ] as const) {
      await dayButton(page, tag, habit).click();
      await expect.poll(() => marked(api, id), `en la BD tras pulsar «${tag}»`).toEqual(after);
      await expectStats(page, habit, [...after], today);
      await expectHeatmap(page, habit, [...after], today);
    }
    expect(await page.evaluate(() => "e2eSinRecarga" in window), "la página no se ha recargado").toBe(true);
  });

  test("D-10: con 500, las estadísticas y el mapa vuelven al estado anterior y sale el genérico", async ({ page, api }) => {
    const habit = `${prefix()}-fallo`;
    const { id, today } = await seedAndOpen(page, api, habit, []);
    await failServerActions(page);
    await dayButton(page, "Hoy", habit).click();
    await expect(alert(page, GENERIC)).toBeVisible();
    await expectStats(page, habit, [], today);
    await expectHeatmap(page, habit, [], today);
    expect(await marked(api, id)).toEqual([]);
  });

  test("D-11: marcar Hoy solo con teclado (Tab y Espacio) actualiza la racha a «1 día»", async ({ page, api }) => {
    const habit = `${prefix()}-teclado`;
    const { id, today } = await seedAndOpen(page, api, habit, []);
    await tabTo(page, dayButton(page, "Hoy", habit));
    await page.keyboard.press("Space");
    await expect.poll(() => marked(api, id)).toEqual([today]);
    await expectStats(page, habit, [today], today);
  });

  test("hábito borrado en otra pestaña: marcar un día → «Ese hábito ya no existe.» (role=alert) y desaparece de la lista", async ({ page, api }) => {
    const habit = `${prefix()}-borrado`;
    const { id } = await seedAndOpen(page, api, habit, []);
    const { error } = await api.from("habits").delete().eq("id", id);
    expect(error).toBeNull();
    await dayButton(page, "Hoy", habit).click();
    await expect(alert(page, GONE)).toBeVisible();
    await expect(item(page, habit), "revalida /app: la fila se va sin recargar").toHaveCount(0);
  });
});

test.describe("accesibilidad y móvil", () => {
  test("D-11: axe sin serious ni critical con estadísticas y mapa (con días marcados), y el nombre del role=img es el correcto", async ({ page, api }) => {
    const p = prefix();
    const [second] = await seed(api, { name: `${p}-dos`, color: "violet" });
    const habit = `${p}-uno`;
    const { today, marks } = await seedAndOpen(page, api, habit, [-4, -1, 0]);
    await mark(api, second, today);
    await page.reload();
    await expectHeatmap(page, habit, marks, today);
    await expectHeatmap(page, `${p}-dos`, [today], today);
    await expectNoSeriousA11yViolations(page);
  });

  test("D-12: a 375×812, con un nombre de 60 caracteres, estadísticas y mapa caben sin scroll horizontal", async ({ page, api }) => {
    const habit = tooLong(prefix()).slice(0, 60);
    await page.setViewportSize({ width: 375, height: 812 });
    const { today, marks } = await seedAndOpen(page, api, habit, [-8, -2, -1, 0]);
    await expectStats(page, habit, marks, today);
    await expectHeatmap(page, habit, marks, today);
    await expectFitsMobile(page, []);
    for (const part of [heatmap(page, habit), item(page, habit).locator("dl")]) {
      const box = (await part.boundingBox())!;
      expect(box.x, "no se sale por la izquierda").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "no se sale por la derecha").toBeLessThanOrEqual(375);
    }
  });
});
