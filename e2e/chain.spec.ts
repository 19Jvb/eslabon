import { expect, test as anonymous, type Locator, type Page } from "@playwright/test";
import { type SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "../src/lib/dates";
import { currentStreak } from "../src/lib/streak";
import {
  COLORS,
  GENERIC,
  HUES,
  MADRID,
  announced,
  chainProblems,
  cleanUp,
  contrast,
  dayAt,
  dayButton,
  expectFitsMobile,
  expectNoSeriousA11yViolations,
  expectStats,
  expectedStats,
  failServerActions,
  hue,
  inHue,
  item,
  mark,
  marked,
  openApp,
  paint,
  prefix,
  readPreview,
  seed,
  shownToday,
  slowSubmits,
  tabTo,
  test,
  type ChainBand,
  type ChainDay,
  type Color,
  type RGB,
} from "./helpers";

// T11d: la cadena como banda continua a cualquier ancho, el aviso de hoy pendiente y las estadísticas de la vista previa.
// /app con el usuario de E2E (lo sembrado empieza por «e2e-» y se borra al terminar) y el navegador en Madrid; la vista
// previa de «/», sin sesión. La cuenta demo no se toca. Lo esperado sale de src/lib/streak.ts.

/** Para los describe de /app: Madrid y limpieza de lo sembrado. */
function appSetup() {
  test.use({ timezoneId: MADRID });
  test.afterEach(async ({ api }) => {
    await cleanUp(api);
  });
}

/** Siembra un hábito con días relativos a hoy (Madrid), abre /app y devuelve su nombre, su id y el «hoy» pintado. */
async function seedAndOpen(page: Page, api: SupabaseClient, offsets: number[], color: Color = "blue", tag = "cadena") {
  const name = `${prefix()}-${tag}`;
  const [id] = await seed(api, { name, color });
  const today = dayAt(MADRID, new Date());
  if (offsets.length) await mark(api, id, ...offsets.map((n) => addDays(today, n)));
  await openApp(page);
  return { name, id, today: await shownToday(page, name, MADRID) };
}

const dayIn = (page: Page, name: string, day: string) => item(page, name).locator(`button[data-day="${day}"]`);

// ---------------------------------------------------------------- La cadena en /app [P1]

/** Los 7 botones de día (de izquierda a derecha, con su offset respecto a hoy como etiqueta) y los [data-link] visibles. */
async function readChain(page: Page, name: string, today: string) {
  const { days, bands } = await item(page, name).evaluate((li) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const onWhite = (color: string) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const seen = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || getComputedStyle(el).visibility !== "visible") return false;
      let opacity = 1;
      for (let n: Element | null = el; n; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity);
      return opacity > 0.01;
    };
    return {
      days: [...li.querySelectorAll("button[data-day]")]
        .map((b) => {
          const s = getComputedStyle(b);
          const radii = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(parseFloat);
          return { ...box(b), label: b.getAttribute("data-day")!, radii, fill: onWhite(s.backgroundColor) };
        })
        .sort((a, b) => a.left - b.left),
      bands: [...li.querySelectorAll("[data-link]")].filter(seen).map((el) => ({ ...box(el), fill: onWhite(getComputedStyle(el).backgroundColor) })),
    };
  });
  const offset = (day: string) => String(Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000));
  return {
    days: days.map((d) => ({ ...d, label: `hoy${offset(d.label)}`, fill: d.fill as RGB })) as ChainDay[],
    bands: bands.map((b) => ({ ...b, fill: b.fill as RGB })) as ChainBand[],
  };
}

/** Los fallos de la cadena de la fila frente a los offsets marcados (−6…0). */
async function problems(page: Page, name: string, today: string, offsets: number[]) {
  const { days, bands } = await readChain(page, name, today);
  if (days.length !== 7) return [`${days.length} botones de día (se esperan 7)`];
  const on = new Set(offsets);
  const linked = Array.from({ length: 6 }, (_, i) => on.has(i - 6) && on.has(i - 5));
  return chainProblems(days, bands, linked);
}

test.describe("T11d · la cadena como banda continua (/app)", () => {
  appSetup();

  // −6 y −5 unidos; −3 marcado y suelto; −1 y 0 unidos. −4 y −2 sin marcar.
  const MARKS = [-6, -5, -3, -1, 0];

  for (const width of [1280, 375]) {
    test(`a ${width} px: entre dos días contiguos marcados, un conector [data-link] de alto ≥ 80 % del botón que toca los dos y con su mismo relleno (el 700 del hábito); las esquinas interiores a 0 y las exteriores como las de un día suelto; sin unir, todo como antes`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      const { name, today } = await seedAndOpen(page, api, MARKS);
      await expect.poll(() => problems(page, name, today, MARKS), { message: "la cadena (vacío = bien)" }).toEqual([]);
      // El relleno compartido es el del hábito (azul) y el mismo que el de un día marcado suelto (hoy−3).
      const { days, bands } = await readChain(page, name, today);
      const lone = days.find((d) => d.label === "hoy-3")!;
      for (const b of bands) {
        expect(inHue(b.fill, "blue"), `conector ${b.fill} (tono ${hue(b.fill).toFixed(0)}°) fuera del azul ${HUES.blue}`).toBe(true);
        expect(b.fill.every((v, k) => Math.abs(v - lone.fill[k]) <= 3), `conector ${b.fill} = relleno de un día marcado ${lone.fill}`).toBe(true);
      }
      if (width === 375) await expectFitsMobile(page, [`Hoy: ${name}`, `Ayer: ${name}`]);
    });
  }

  test("sigue a la UI optimista: la banda y las esquinas cambian al instante al marcar y desmarcar (antes de que responda el servidor) y, con un 500, vuelven a como estaban", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const { name, id, today } = await seedAndOpen(page, api, MARKS);
    await expect.poll(() => problems(page, name, today, MARKS)).toEqual([]);
    const sent = await slowSubmits(page);
    const gap = dayIn(page, name, addDays(today, -2));

    await gap.click();
    // El envío tarda 1,5 s: si cambia antes, es la UI optimista.
    await expect
      .poll(() => problems(page, name, today, [-6, -5, -3, -2, -1, 0]), { timeout: 1000, message: "al marcar hoy−2, −3…0 se unen al instante" })
      .toEqual([]);
    await expect.poll(() => marked(api, id)).toContain(addDays(today, -2));
    await page.waitForTimeout(800);
    await gap.click();
    await expect.poll(() => problems(page, name, today, MARKS), { timeout: 1000, message: "al desmarcar hoy−2, se separan al instante" }).toEqual([]);
    await expect.poll(async () => (await marked(api, id)).includes(addDays(today, -2))).toBe(false);
    expect(sent.length, "un envío por clic").toBe(2);
    await page.waitForTimeout(800);

    await page.unrouteAll({ behavior: "wait" });
    await failServerActions(page);
    await dayIn(page, name, addDays(today, -4)).click();
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(dayIn(page, name, addDays(today, -4))).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => problems(page, name, today, MARKS), { message: "tras el 500, la cadena vuelve a como estaba" }).toEqual([]);
  });
});

// ---------------------------------------------------------------- Aviso de hoy pendiente [P2]

const NUDGE = /^\s*Marca hoy para/;
const reach = (n: number) => `Marca hoy para llegar a ${n} días`;
const START = "Marca hoy para empezar tu cadena";
/** Los avisos que se ven en la tarjeta del hábito. */
const nudge = (page: Page, name: string) => item(page, name).getByText(NUDGE).filter({ visible: true });

/** El aviso se ve una vez, con ese texto exacto, fuera de la <dl> y debajo de ella. */
async function expectNudge(page: Page, name: string, text: string | null, timeout?: number) {
  const shown = nudge(page, name);
  if (text === null) {
    await expect(shown, `«${name}»: con hoy marcado no hay aviso`).toHaveCount(0, { timeout });
    return;
  }
  await expect(shown, `«${name}»: un aviso visible`).toHaveCount(1, { timeout });
  await expect(shown).toHaveText(text, { timeout });
  const where = await shown.evaluate((el) => {
    const dl = el.closest("li")?.querySelector("dl");
    return { inDl: el.closest("dl") !== null, top: el.getBoundingClientRect().top, dlBottom: dl ? dl.getBoundingClientRect().bottom : NaN };
  });
  expect(where.inDl, `«${name}»: el aviso va fuera de la <dl>`).toBe(false);
  expect(where.top, `«${name}»: el aviso va debajo de las estadísticas`).toBeGreaterThanOrEqual(where.dlBottom - 1);
}

/** Cada texto visible del elemento: su color pintado sobre su fondo (los fondos de sus antepasados). */
const inks = (target: Locator) =>
  target.evaluate((root) => {
    const found: { text: string; chain: string[]; color: string }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      const r = el.getBoundingClientRect();
      if (!(n.textContent ?? "").trim() || r.width <= 1 || r.height <= 1) continue;
      const chain: string[] = [];
      for (let x: Element | null = el; x; x = x.parentElement) chain.unshift(getComputedStyle(x).backgroundColor);
      found.push({ text: (n.textContent ?? "").trim(), chain, color: getComputedStyle(el).color });
    }
    return found;
  });

test.describe("T11d · aviso de hoy pendiente (/app)", () => {
  appSetup();

  test("con hoy sin marcar: «Marca hoy para llegar a N días» (N = racha + 1) o «Marca hoy para empezar tu cadena» con racha 0, fuera de la <dl> y debajo; con hoy marcado, nada; la <dl> no cambia; axe sin serious ni critical", async ({ page, api }) => {
    const p = prefix();
    const cases: [string, number[], string | null][] = [
      [`${p}-r2`, [-1, -2], reach(3)],
      [`${p}-r1`, [-1], reach(2)],
      [`${p}-vacio`, [], START],
      [`${p}-roto`, [-2, -3], START],
      [`${p}-hoy2`, [0, -1], null],
      [`${p}-hoy1`, [0], null],
    ];
    const ids = await seed(api, ...cases.map(([name]) => ({ name })));
    const today = dayAt(MADRID, new Date());
    for (const [i, [, offsets]] of cases.entries()) if (offsets.length) await mark(api, ids[i], ...offsets.map((n) => addDays(today, n)));
    await openApp(page);
    for (const [i, [name, , text]] of cases.entries()) {
      const shownDay = await shownToday(page, name, MADRID);
      const marks = await marked(api, ids[i]);
      // Comprobación del propio test: el texto esperado es el de la regla N = currentStreak + 1.
      const r = currentStreak(marks, shownDay);
      expect(text, `regla del aviso para «${name}»`).toBe(marks.includes(shownDay) ? null : r >= 1 ? reach(r + 1) : START);
      await expectNudge(page, name, text);
      await expectStats(page, name, marks, shownDay);
    }
    await expectNoSeriousA11yViolations(page);
  });

  test("contraste del aviso ≥ 4.5:1 en los 6 colores, y a 375×812 se ve sin scroll horizontal", async ({ page, api }) => {
    const p = prefix();
    const names = COLORS.map((c) => `${p}-${c}`);
    const ids = await seed(api, ...COLORS.map((color, i) => ({ name: names[i], color })));
    const today = dayAt(MADRID, new Date());
    for (const id of ids) await mark(api, id, addDays(today, -1));
    await openApp(page);
    for (const [i, color] of COLORS.entries()) {
      await expectNudge(page, names[i], reach(2));
      const found = await inks(nudge(page, names[i]));
      expect(found.length, `${color}: el aviso tiene texto visible`).toBeGreaterThan(0);
      for (const t of found) {
        const bg = await paint(page, t.chain);
        const ink = await paint(page, [...t.chain, t.color]);
        expect(contrast(ink, bg), `${color}: contraste de «${t.text}» (${ink} sobre ${bg})`).toBeGreaterThanOrEqual(4.5);
      }
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await expectNudge(page, names[0], reach(2));
    await expectFitsMobile(page, []);
  });

  test("se actualiza al instante con la UI optimista (también solo con teclado) y, con un 500, vuelve a como estaba", async ({ page, api }) => {
    const { name, id, today } = await seedAndOpen(page, api, [-1, -2], "green", "aviso");
    await expectNudge(page, name, reach(3));
    const sent = await slowSubmits(page);
    const hoy = dayButton(page, "Hoy", name);
    const ayer = dayButton(page, "Ayer", name);

    // D-11: marcar hoy solo con teclado. El envío tarda 1,5 s: lo que cambie antes es la UI optimista.
    await tabTo(page, hoy);
    await page.keyboard.press("Space");
    await expectNudge(page, name, null, 1000);
    await expect.poll(() => marked(api, id)).toContain(today);
    await page.waitForTimeout(800);

    await hoy.click();
    await expectNudge(page, name, reach(3), 1000);
    await expect.poll(async () => (await marked(api, id)).includes(today)).toBe(false);
    await page.waitForTimeout(800);

    // Desmarcar ayer deja la racha en 0.
    await ayer.click();
    await expectNudge(page, name, START, 1000);
    await expect.poll(async () => (await marked(api, id)).includes(addDays(today, -1))).toBe(false);
    await page.waitForTimeout(800);
    await ayer.click();
    await expectNudge(page, name, reach(3), 1000);
    await expect.poll(() => marked(api, id)).toContain(addDays(today, -1));
    expect(sent.length, "un envío por acción").toBe(4);
    await page.waitForTimeout(800);

    await page.unrouteAll({ behavior: "wait" });
    await failServerActions(page);
    await hoy.click();
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(hoy).toHaveAttribute("aria-pressed", "false");
    await expectNudge(page, name, reach(3));
    await expectStats(page, name, await marked(api, id), today);
  });
});

// ---------------------------------------------------------------- Vista previa de la landing [P1 y P2]

/** Las <dl> de la vista previa (pares <dt>/<dd> y la cifra de cada <dd>) y sus avisos de hoy pendiente. */
const readPreviewStats = (page: Page) =>
  page.evaluate(() => {
    const root = [...document.querySelectorAll('[aria-hidden="true"], [role="img"]')].find((el) => (el.textContent ?? "").includes("Leer 20 minutos"));
    if (!root) return null;
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
    const figure = (dd: Element) => {
      const walker = document.createTreeWalker(dd, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement!;
        const r = el.getBoundingClientRect();
        if (!/\d/.test(n.textContent ?? "") || r.width <= 1 || r.height <= 1) continue;
        const s = getComputedStyle(el);
        const chain: string[] = [];
        for (let x: Element | null = el; x; x = x.parentElement) chain.unshift(getComputedStyle(x).backgroundColor);
        return { size: parseFloat(s.fontSize), family: s.fontFamily.toLowerCase().replace(/[^a-z]/g, ""), color: s.color, chain };
      }
      return null;
    };
    const dls = [...root.querySelectorAll("dl")];
    const pairs = dls.map((dl) =>
      [...dl.querySelectorAll("dt")].map((dt) => [clean(dt.textContent), dt.nextElementSibling?.tagName === "DD" ? clean(dt.nextElementSibling.textContent) : ""]),
    );
    const figures = dls[0] ? [...dls[0].querySelectorAll("dd")].map(figure) : [];
    const dlBottom = dls[0] ? dls[0].getBoundingClientRect().bottom : NaN;
    // El aviso: el elemento más interno cuyo texto empieza por «Marca hoy para» y que se ve.
    const nudges = [...root.querySelectorAll("*")]
      .filter((el) => /^Marca hoy para/.test(clean(el.textContent)) && ![...el.children].some((c) => /^Marca hoy para/.test(clean(c.textContent))))
      .filter((el) => el.getBoundingClientRect().width > 1)
      .map((el) => ({ text: clean(el.textContent), inDl: el.closest("dl") !== null, top: el.getBoundingClientRect().top }));
    return { pairs, figures, dlBottom, nudges };
  });

/** Iniciales de la semana en el orden de la app (lunes = 0). */
const WEEK = "LMXJVSD";

anonymous.describe("T11d · vista previa de la landing", () => {
  for (const width of [1280, 375]) {
    anonymous(`a ${width} px: la cadena de la vista previa es una banda continua (conector ≥ 80 % del alto de la caja del día, tocando las dos y con su relleno) y las esquinas interiores de las cajas unidas van a 0`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const preview = await readPreview(page);
      expect(preview, "la vista previa (aria-hidden o role=img con «Leer 20 minutos»)").not.toBeNull();
      const { row, days, bands } = preview!;
      expect(row, "la fila de 7 días que termina en «Hoy»").toHaveLength(7);
      const linked = row.slice(0, 6).map((d, i) => d.filled && row[i + 1].filled);
      expect(linked.some(Boolean), `al menos dos días contiguos marcados: ${row.map((d) => `${d.text}${d.filled ? "■" : "□"}`).join(" ")}`).toBe(true);
      expect(chainProblems(days as ChainDay[], bands as ChainBand[], linked), "la cadena de la vista previa (vacío = bien)").toEqual([]);
      if (width === 375) await expectFitsMobile(page, []);
    });
  }

  anonymous("estadísticas: una <dl> con «Racha actual», «Mejor racha» y «Últimos 30 días» calculadas con streak.ts sobre su propio patrón (el mapa, cuya última semana es la fila), la racha destacada como en la app y el aviso de hoy pendiente con N = racha + 1, fuera de la <dl> y debajo", async ({ page }) => {
    await page.goto("/");
    const preview = (await readPreview(page))!;
    expect(preview, "la vista previa").not.toBeNull();
    const { row, map } = preview;
    expect(row, "la fila de 7 días que termina en «Hoy»").toHaveLength(7);
    expect(row[6].filled, "hoy sin marcar en la vista previa (si no, no hay aviso que enseñar)").toBe(false);

    // El «hoy» de la vista previa: un día cualquiera con el día de la semana que dicen sus iniciales.
    const initials = row.slice(0, row[5].text === "Ayer" ? 5 : 6).map((d) => d.text);
    const todayDow = (WEEK.indexOf(initials[0]) + 6) % 7;
    const today = addDays("2026-01-05", todayDow); // 2026-01-05 es lunes.
    const rowMarks = row.flatMap((d, i) => (d.filled ? [addDays(today, i - 6)] : []));

    // El mapa: columnas = semanas (la última, la de hoy) y filas = lunes…domingo, por su posición.
    const cluster = (values: number[]) => values.sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - all[i - 1] > 1);
    const cols = cluster(map.map((c) => c.cx));
    const rows = cluster(map.map((c) => c.cy));
    expect(rows.length, "el mapa tiene 7 filas (lunes a domingo)").toBe(7);
    const index = (values: number[], v: number) => values.findIndex((x) => Math.abs(x - v) <= 1);
    const dayOf = (c: (typeof map)[number]) => addDays(today, (index(cols, c.cx) - (cols.length - 1)) * 7 + (index(rows, c.cy) - todayDow));
    const mapMarks = map.filter((c) => c.done).map(dayOf).sort();
    expect(mapMarks.every((d) => d <= today), "ninguna celda futura está rellena").toBe(true);
    const shown = (marks: string[]) => Array.from({ length: 7 }, (_, i) => (marks.includes(addDays(today, i - 6)) ? "■" : "□")).join("");
    expect(shown(mapMarks), "la última semana del mapa es la fila de días").toBe(shown(rowMarks));

    const stats = (await readPreviewStats(page))!;
    expect(stats.pairs.length, "una <dl> en la vista previa").toBe(1);
    const expected = Object.entries(expectedStats(mapMarks, today));
    const past = map.filter((c) => dayOf(c) <= today).length;
    if (past >= 30) {
      expect(stats.pairs[0], "las tres estadísticas, en orden, con sus valores del patrón").toEqual(expected);
    } else {
      // Sin 30 días en el mapa no se puede recalcular el %: se comprueban los nombres y las dos rachas.
      expect(stats.pairs[0].map(([dt]) => dt)).toEqual(expected.map(([dt]) => dt));
      expect(stats.pairs[0].slice(0, 2)).toEqual(expected.slice(0, 2));
    }
    // Comprobación independiente con la fila sola: si la racha se corta dentro de la fila, la fila ya la da entera.
    const fromRow = currentStreak(rowMarks, today);
    const streakText = stats.pairs[0][0][1];
    if (fromRow < 6) expect(streakText, "la racha actual, contada en la fila").toBe(`${fromRow} ${fromRow === 1 ? "día" : "días"}`);

    // La racha destacada como en la app: 1,5× o más que los otros dos valores, en Bricolage Grotesque y en el tono del hábito.
    const [streak, ...rest] = stats.figures;
    expect(streak && rest.length === 2 && rest.every(Boolean), "las tres cifras se ven").toBe(true);
    for (const other of rest) expect(streak!.size, `la racha (${streak!.size}px) frente a ${other!.size}px`).toBeGreaterThanOrEqual(1.5 * other!.size);
    expect(streak!.family, "familia de la cifra de «Racha actual»").toContain("bricolagegrotesque");
    const bg = await paint(page, streak!.chain);
    const ink = await paint(page, [...streak!.chain, streak!.color]);
    const tone = COLORS.find((c) => inHue(preview.days.find((d, i) => row[i].filled)!.fill, c))!;
    expect(inHue(ink, tone), `cifra ${ink} (tono ${hue(ink).toFixed(0)}°) en el tono del hábito (${tone})`).toBe(true);
    expect(contrast(ink, bg), "contraste de la cifra de «Racha actual»").toBeGreaterThanOrEqual(4.5);

    // El aviso: con la racha R del patrón (hoy sin marcar), «llegar a R + 1 días» o «empezar tu cadena».
    const r = currentStreak(mapMarks, today);
    expect(stats.nudges.map((n) => n.text), "un aviso de hoy pendiente").toEqual([r >= 1 ? reach(r + 1) : START]);
    expect(stats.nudges[0].inDl, "el aviso va fuera de la <dl>").toBe(false);
    expect(stats.nudges[0].top, "el aviso va debajo de las estadísticas").toBeGreaterThanOrEqual(stats.dlBottom - 1);
  });
});
