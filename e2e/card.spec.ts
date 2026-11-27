import { expect, type Locator, type Page } from "@playwright/test";
import { type SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "../src/lib/dates";
import { heatmapWeeks } from "../src/lib/streak";
import {
  COLORS,
  GENERIC,
  HUES,
  MADRID,
  TRANSFORM,
  announced,
  backdrop,
  button,
  cleanUp,
  contrast,
  dayAt,
  dayButton,
  expectFitsMobile,
  expectHeatmap,
  expectNoSeriousA11yViolations,
  expectStats,
  failServerActions,
  heatmap,
  hue,
  inHue,
  item,
  luminance,
  mark,
  marked,
  moving,
  openApp,
  paint,
  prefix,
  pressedScale,
  readStats,
  recordAnimations,
  seed,
  shownToday,
  slowSubmits,
  test,
  transitionsOf,
  visibleTexts,
  type Color,
  type Recorded,
} from "./helpers";

// T11b: la tarjeta del hábito («Hoy» visible, jerarquía de la <dl>, mapa legible, cadena dibujada y movimiento), con el
// usuario de E2E y el navegador en Madrid. Igual que en T11, solo lo medible: estilos computados, cajas, contraste
// calculado y las animaciones que de verdad arrancan (grabadas frame a frame con recordAnimations).
// La regla de movimiento de T11 se amplía con permiso del humano: la lista blanca está en helpers.ts y los tests de
// reposo de T11 (polish.spec «8 ·») se reescribieron contra ella.

test.use({ timezoneId: MADRID });

test.afterEach(async ({ api }) => {
  await cleanUp(api);
});

/** Siembra un hábito con días relativos a hoy (Madrid), abre /app y devuelve su nombre, su id y el «hoy» pintado. */
async function seedAndOpen(page: Page, api: SupabaseClient, offsets: number[], color: Color = "green", tag = "card") {
  const name = `${prefix()}-${tag}`;
  const [id] = await seed(api, { name, color });
  const today = dayAt(MADRID, new Date());
  if (offsets.length) await mark(api, id, ...offsets.map((n) => addDays(today, n)));
  await openApp(page);
  return { name, id, today: await shownToday(page, name, MADRID) };
}

const dayIn = (page: Page, name: string, day: string) => item(page, name).locator(`button[data-day="${day}"]`);

/** Pinta el color de un borde sobre lo que el elemento tiene detrás. */
async function borderColor(page: Page, target: Locator) {
  const { color, width, style } = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    const sides = ["top", "right", "bottom", "left"];
    return {
      color: s.borderTopColor,
      width: Math.min(...sides.map((side) => parseFloat(s.getPropertyValue(`border-${side}-width`)))),
      style: s.borderTopStyle,
    };
  });
  return { rgb: await paint(page, [...(await backdrop(target, false)), color]), width, style };
}

// ---------------------------------------------------------------- Hoy visible [P1]

test.describe("T11b · «Hoy» visible", () => {
  test("a 375×812: «Hoy» y «Ayer» se ven escritos encima de su número, sin la inicial, con el mismo nombre accesible; 44×44 y sin scroll", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const { name, today } = await seedAndOpen(page, api, []);
    for (const [tag, day] of [
      ["Hoy", today],
      ["Ayer", addDays(today, -1)],
    ] as const) {
      const b = dayButton(page, tag, name);
      await expect(b, "el nombre accesible no cambia").toHaveAccessibleName(`${tag}: ${name}`);
      const texts = await visibleTexts(b);
      const number = String(Number(day.slice(8)));
      expect(texts.map((t) => t.text).join(""), `«${tag}»: lo que se ve es «${tag}» y el número, sin la inicial`).toBe(`${tag}${number}`);
      const word = texts.find((t) => t.text === tag)!;
      const digits = texts.find((t) => t.text === number)!;
      expect(word.bottom, `«${tag}» encima del número`).toBeLessThanOrEqual(digits.top + 1);
      const box = (await b.boundingBox())!;
      expect(word.left >= box.x - 0.5 && word.right <= box.x + box.width + 0.5, `«${tag}» cabe en su botón a 375 px`).toBe(true);
    }
    await expectFitsMobile(page, [`Hoy: ${name}`, `Ayer: ${name}`]);
  });

  test("hoy sin marcar: borde de 2 px o más en neutral-900, más oscuro que el de los demás días sin marcar", async ({ page, api }) => {
    const { name, today } = await seedAndOpen(page, api, []);
    const hoy = await borderColor(page, dayIn(page, name, today));
    expect(hoy.style, "«Hoy» con borde").not.toBe("none");
    expect(hoy.width, "grosor del borde de «Hoy» (el lado más fino)").toBeGreaterThanOrEqual(2);
    // neutral-900 (#171717) contra blanco: 17,9:1. Se acepta de neutral-900 a negro, gris (sin tono).
    expect(contrast(hoy.rgb, [255, 255, 255]), `borde de «Hoy» ${hoy.rgb}: neutral-900`).toBeGreaterThanOrEqual(16);
    expect(Math.max(...hoy.rgb) - Math.min(...hoy.rgb), `borde de «Hoy» ${hoy.rgb}: gris neutro`).toBeLessThanOrEqual(6);
    for (const n of [-1, -2, -6]) {
      const other = await borderColor(page, dayIn(page, name, addDays(today, n)));
      expect(luminance(other.rgb), `el borde de hoy${n} (${other.rgb}) es más claro que el de «Hoy» (${hoy.rgb})`).toBeGreaterThan(luminance(hoy.rgb));
    }
  });
});

// ---------------------------------------------------------------- Jerarquía [P2]

/** La cifra de cada <dd>: el elemento del primer texto visible con un dígito, con su tamaño, familia, color y fondos. */
const figures = (page: Page, name: string) =>
  item(page, name)
    .locator("dl")
    .evaluate((dl) =>
      [...dl.querySelectorAll("dd")].map((dd) => {
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
      }),
    );

test.describe("T11b · jerarquía de la <dl>", () => {
  test("«Racha actual» en Bricolage Grotesque, 1,5× o más que los otros dos valores (que siguen en Instrument Sans) y en el tono del hábito con contraste ≥ 4.5:1, en los 6 colores; la <dl> no cambia", async ({ page, api }) => {
    const p = prefix();
    const names = COLORS.map((c) => `${p}-${c}`);
    const ids = await seed(api, ...COLORS.map((color, i) => ({ name: names[i], color })));
    const today = dayAt(MADRID, new Date());
    for (const id of ids) await mark(api, id, today, addDays(today, -1));
    await openApp(page);
    for (const [i, color] of COLORS.entries()) {
      const name = names[i];
      await expectStats(page, name, await marked(api, ids[i]), await shownToday(page, name, MADRID));
      const [streak, ...rest] = await figures(page, name);
      expect(streak && rest.every(Boolean), `«${name}»: las tres cifras se ven`).toBe(true);
      expect(streak!.family, `${color}: familia de la cifra de «Racha actual»`).toContain("bricolagegrotesque");
      for (const other of rest) {
        expect(streak!.size, `${color}: la racha (${streak!.size}px) frente a ${other!.size}px`).toBeGreaterThanOrEqual(1.5 * other!.size);
        expect(other!.family, `${color}: los otros dos valores siguen en Instrument Sans`).toContain("instrumentsans");
      }
      const bg = await paint(page, streak!.chain);
      const ink = await paint(page, [...streak!.chain, streak!.color]);
      expect(inHue(ink, color), `${color}: cifra ${ink} (tono ${hue(ink).toFixed(0)}°) fuera de ${HUES[color]}`).toBe(true);
      expect(contrast(ink, bg), `${color}: contraste de la cifra de «Racha actual»`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ---------------------------------------------------------------- Mapa legible [P2]

type Cell = { day: string; left: number; top: number; right: number; bottom: number; width: number; height: number };
const cellBoxes = (page: Page, name: string) =>
  heatmap(page, name)
    .locator("[data-day]")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { day: el.getAttribute("data-day")!, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      }),
    );

/** Anillo visible: outline con grosor, o una sombra (ring de Tailwind) que no sea solo capas transparentes. */
const ringOf = (target: Locator) =>
  target.evaluate((el) => {
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 ? `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}` : "";
    const shadow = s.boxShadow === "none" ? "" : s.boxShadow.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px,?\s*/g, "").trim();
    return { visible: outline !== "" || shadow !== "", signature: `${outline}|${shadow}` };
  });

test.describe("T11b · mapa legible", () => {
  test("celdas de 12×12 px separadas 3 px; las etiquetas L, X y V a la izquierda, en las filas de lunes, miércoles y viernes, aria-hidden y fuera de las 84 [data-day]; el nombre del role=img no cambia", async ({ page, api }) => {
    const { name, id, today } = await seedAndOpen(page, api, [0, -2]);
    const marks = await marked(api, id);
    await expectHeatmap(page, name, marks, today);
    const grid = heatmapWeeks(marks, today);
    const byDay = new Map((await cellBoxes(page, name)).map((c) => [c.day, c]));
    const at = (w: number, d: number): Cell => byDay.get(grid[w][d].day)!;
    for (const c of byDay.values()) {
      expect(Math.abs(c.width - 12) < 0.5 && Math.abs(c.height - 12) < 0.5, `celda ${c.day}: ${c.width}×${c.height} (se esperan 12×12)`).toBe(true);
    }
    for (let w = 0; w < 12; w++) {
      for (let d = 0; d < 7; d++) {
        if (w < 11) expect(Math.abs(at(w + 1, d).left - at(w, d).right - 3), `hueco entre columnas en ${at(w, d).day}`).toBeLessThan(0.5);
        if (d < 6) expect(Math.abs(at(w, d + 1).top - at(w, d).bottom - 3), `hueco entre filas en ${at(w, d).day}`).toBeLessThan(0.5);
      }
    }

    const minLeft = Math.min(...[...byDay.values()].map((c) => c.left));
    const labels = await item(page, name).evaluate((li) =>
      [...li.querySelectorAll("*")]
        .filter((el) => !el.closest("button"))
        .map((el) => ({ el, own: [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim() }))
        .filter(({ own }) => ["L", "X", "V"].includes(own))
        .map(({ el, own }) => {
          const r = el.getBoundingClientRect();
          return {
            text: own,
            hidden: el.closest('[aria-hidden="true"]') !== null,
            inDay: el.closest("[data-day]") !== null || el.hasAttribute("data-day"),
            right: r.right,
            cy: (r.top + r.bottom) / 2,
            visible: r.width > 0 && r.height > 0,
          };
        }),
    );
    for (const [text, row] of [
      ["L", 0],
      ["X", 2],
      ["V", 4],
    ] as const) {
      const rowCenter = (at(0, row).top + at(0, row).bottom) / 2;
      const found = labels.filter((l) => l.text === text && l.visible && l.right <= minLeft + 0.5 && Math.abs(l.cy - rowCenter) <= 3);
      expect(found.length, `etiqueta «${text}» a la izquierda de la fila ${row} (encontradas: ${JSON.stringify(labels)})`).toBeGreaterThan(0);
      expect(found.every((l) => l.hidden && !l.inDay), `«${text}»: aria-hidden y fuera de las [data-day]`).toBe(true);
    }
  });

  test("la celda de hoy lleva data-today=true (solo ella) y un anillo visible que no tienen las demás", async ({ page, api }) => {
    const { name, today } = await seedAndOpen(page, api, [0, -1]);
    const heat = heatmap(page, name);
    const marked_ = heat.locator('[data-today="true"]');
    await expect(marked_, "una sola celda con data-today=true").toHaveCount(1);
    await expect(marked_).toHaveAttribute("data-day", today);
    const ring = await ringOf(marked_);
    expect(ring.visible, `anillo de la celda de hoy: ${ring.signature}`).toBe(true);
    for (const n of [-1, -2]) {
      const other = await ringOf(heat.locator(`[data-day="${addDays(today, n)}"]`));
      expect(other.signature, `hoy${n} no lleva el anillo de hoy`).not.toBe(ring.signature);
    }
  });

  test("pie visible y aria-hidden bajo el mapa: «Últimas 12 semanas» y la leyenda cumplido, sin marcar y futuro", async ({ page, api }) => {
    const { name } = await seedAndOpen(page, api, [0]);
    const bottom = Math.max(...(await cellBoxes(page, name)).map((c) => c.bottom));
    const parts = [
      item(page, name).getByText("Últimas 12 semanas", { exact: true }),
      item(page, name).getByText(/^\s*cumplido\s*$/i),
      item(page, name).getByText(/^\s*sin marcar\s*$/i),
      item(page, name).getByText(/^\s*futuro\s*$/i),
    ];
    for (const part of parts) {
      await expect(part.first(), `en el pie: ${part}`).toBeVisible();
      const where = await part.first().evaluate((el) => ({ hidden: el.closest('[aria-hidden="true"]') !== null, top: el.getBoundingClientRect().top }));
      expect(where.hidden, `${part}: aria-hidden`).toBe(true);
      expect(where.top, `${part}: debajo de las celdas`).toBeGreaterThanOrEqual(bottom - 1);
    }
  });
});

// ---------------------------------------------------------------- La cadena

/** Conectores [data-link] que se ven, como «desde→hasta» (offsets respecto a hoy), con si son aria-hidden y su color. */
async function links(page: Page, name: string, today: string) {
  const found = await item(page, name).evaluate((li) => {
    const days = [...li.querySelectorAll("button[data-day]")].map((b) => {
      const r = b.getBoundingClientRect();
      return { day: b.getAttribute("data-day")!, cx: (r.left + r.right) / 2, top: r.top, bottom: r.bottom };
    });
    const seen = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || getComputedStyle(el).visibility !== "visible") return false;
      let opacity = 1;
      for (let n: Element | null = el; n; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity);
      return opacity > 0.01;
    };
    return [...li.querySelectorAll("[data-link]")].filter(seen).map((el) => {
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const i = days.findIndex((d, k) => k < days.length - 1 && d.cx < cx && cx < days[k + 1].cx);
      const inRow = i >= 0 && cy >= days[i].top && cy <= days[i].bottom;
      const s = getComputedStyle(el);
      return {
        from: inRow ? days[i].day : null,
        to: inRow ? days[i + 1].day : null,
        hidden: el.closest('[aria-hidden="true"]') !== null,
        width: r.width,
        bg: s.backgroundColor,
        border: s.borderTopColor,
      };
    });
  });
  const offset = (day: string | null) => (day === null ? "fuera de la fila" : String(Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000)));
  return found.map((l) => ({ ...l, pair: `${offset(l.from)}→${offset(l.to)}` }));
}
const pairs = async (page: Page, name: string, today: string) => (await links(page, name, today)).map((l) => l.pair).sort();

test.describe("T11b · la cadena entre días contiguos", () => {
  const MARKS = [-6, -5, -3, -1, 0];
  const CHAIN = ["-1→0", "-6→-5"];

  test("solo entre dos días contiguos marcados hay un conector [data-link] visible, aria-hidden, de ancho > 0 y en el tono del hábito; axe sin serious ni critical", async ({ page, api }) => {
    const { name, today } = await seedAndOpen(page, api, MARKS, "blue");
    await expect.poll(() => pairs(page, name, today), { message: "conectores visibles (offsets respecto a hoy)" }).toEqual(CHAIN);
    for (const l of await links(page, name, today)) {
      expect(l.hidden, `${l.pair}: aria-hidden`).toBe(true);
      expect(l.width, `${l.pair}: ancho`).toBeGreaterThan(0);
      let rgb = await paint(page, [l.bg]);
      if (rgb.join() === "255,255,255") rgb = await paint(page, [l.border]);
      expect(inHue(rgb, "blue"), `${l.pair}: color ${rgb} (tono ${hue(rgb).toFixed(0)}°) fuera del azul ${HUES.blue}`).toBe(true);
    }
    await expectNoSeriousA11yViolations(page);
  });

  test("sigue a la UI optimista: aparece y desaparece al instante (antes de que responda el servidor) y, con un 500, vuelve atrás con el genérico", async ({ page, api }) => {
    const { name, id, today } = await seedAndOpen(page, api, MARKS, "blue");
    await expect.poll(() => pairs(page, name, today)).toEqual(CHAIN);
    const sent = await slowSubmits(page);
    const gap = dayIn(page, name, addDays(today, -2));

    await gap.click();
    // El envío tarda 1,5 s: si cambia antes, es la UI optimista.
    await expect.poll(() => pairs(page, name, today), { timeout: 1000, message: "al marcar hoy−2, la cadena se une al instante" }).toEqual(["-1→0", "-2→-1", "-3→-2", "-6→-5"]);
    await expect.poll(() => marked(api, id)).toContain(addDays(today, -2));
    await page.waitForTimeout(800);
    await gap.click();
    await expect.poll(() => pairs(page, name, today), { timeout: 1000, message: "al desmarcar hoy−2, se rompe al instante" }).toEqual(CHAIN);
    await expect.poll(async () => (await marked(api, id)).includes(addDays(today, -2))).toBe(false);
    expect(sent.length, "un envío por clic").toBe(2);
    await page.waitForTimeout(800);

    await page.unrouteAll({ behavior: "wait" });
    await failServerActions(page);
    await dayIn(page, name, addDays(today, -4)).click();
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(dayIn(page, name, addDays(today, -4))).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => pairs(page, name, today), { message: "tras el 500, la cadena vuelve a como estaba" }).toEqual(CHAIN);
  });
});

// ---------------------------------------------------------------- Movimiento y anuncio

const isTransform = (p: string) => TRANSFORM.includes(p);
const streakValue = async (page: Page, name: string) => (await readStats(page, name))[0]?.[0]?.[1];

test.describe("T11b · movimiento", () => {
  test("(2) al pulsar, «Crear» y un botón de día bajan a scale 0.97 con una transición de transform de ≤ 160 ms", async ({ page, api }) => {
    const { name } = await seedAndOpen(page, api, []);
    for (const target of [button(page, "Crear"), dayButton(page, "Ayer", name)]) {
      const press = (await transitionsOf(target)).filter((t) => isTransform(t.property));
      expect(press.length, `${target}: transición de transform`).toBeGreaterThan(0);
      for (const t of press) expect(t.ms, `${target}: ${t.property}`).toBeLessThanOrEqual(160);
      expect(await pressedScale(page, target), `${target}: escala mientras está pulsado`).toBeCloseTo(0.97, 2);
    }
    await expect(dayButton(page, "Ayer", name), "soltar fuera no marca el día").toHaveAttribute("aria-pressed", "false");
  });

  test("(3) pulso: al cargar no se anima nada en la <dl>; al SUBIR la racha por una acción, solo su cifra hace un pulso de transform/opacity de ≤ 200 ms; al bajar, nada", async ({ page, api }) => {
    const take = await recordAnimations(page);
    // Ayer y hoy−2 marcados: la racha es 2 con hoy sin marcar; marcar hoy la sube a 3.
    const { name, id, today } = await seedAndOpen(page, api, [-1, -2]);
    await expect.poll(() => streakValue(page, name)).toBe("2 días");
    await page.waitForTimeout(1000);
    expect((await take()).filter((r) => r.dd >= 0), "al cargar, animaciones en la <dl>").toEqual([]);

    await dayButton(page, "Hoy", name).click();
    await expect.poll(() => streakValue(page, name)).toBe("3 días");
    await page.waitForTimeout(500);
    const up = (await take()).filter((r) => r.dd >= 0);
    expect(up.length, "al subir la racha, la cifra hace un pulso").toBeGreaterThan(0);
    const describe = (r: Recorded) => `${r.where} dd=${r.dd} ${r.props.join("+")} ${r.ms}ms`;
    for (const r of up) {
      expect(r.dd, `solo la cifra de «Racha actual»: ${describe(r)}`).toBe(0);
      expect(r.props.every((p) => isTransform(p) || p === "opacity"), `solo transform/opacity: ${describe(r)}`).toBe(true);
      expect(r.ms, `≤ 200 ms: ${describe(r)}`).toBeLessThanOrEqual(200);
    }
    expect(up.some((r) => r.props.some(isTransform)), `el pulso mueve transform: ${up.map(describe).join(" | ")}`).toBe(true);

    await expect.poll(() => marked(api, id)).toContain(today);
    await page.waitForTimeout(800);
    await take();
    await dayButton(page, "Hoy", name).click();
    await expect.poll(() => streakValue(page, name)).toBe("2 días");
    await expect.poll(async () => (await marked(api, id)).includes(today)).toBe(false);
    await page.waitForTimeout(800);
    expect((await take()).filter((r) => r.dd >= 0).map(describe), "al bajar la racha no hay pulso").toEqual([]);
  });

  test("(4) el diálogo de borrar entra con opacity y transform (@starting-style) de ≤ 200 ms y queda centrado", async ({ page, api }) => {
    const take = await recordAnimations(page);
    const { name } = await seedAndOpen(page, api, []);
    await page.waitForTimeout(500);
    await take();
    await button(page, `Borrar ${name}`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500);
    const entry = (await take()).filter((r) => r.inDialog);
    const props = entry.flatMap((r) => r.props);
    expect(props, `la entrada anima la opacidad: ${JSON.stringify(entry)}`).toContain("opacity");
    expect(props.some(isTransform), `la entrada anima la escala: ${JSON.stringify(entry)}`).toBe(true);
    for (const r of entry) {
      expect(r.props.every((p) => isTransform(p) || ["opacity", "display", "overlay"].includes(p)), `solo opacity/transform: ${JSON.stringify(r)}`).toBe(true);
      expect(r.ms, `≤ 200 ms: ${JSON.stringify(r)}`).toBeLessThanOrEqual(200);
    }
    const box = (await dialog.boundingBox())!;
    const view = page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - view.width / 2), "centrado en horizontal").toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + box.height / 2 - view.height / 2), "centrado en vertical").toBeLessThanOrEqual(2);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  test("con prefers-reduced-motion: reduce nada se mueve: ni en reposo, ni al pulsar, ni al marcar (relleno y pulso), ni al abrir el diálogo", async ({ page, api }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const take = await recordAnimations(page);
    const { name, id, today } = await seedAndOpen(page, api, [-1, -2]);
    expect(await moving(page, ""), "en reposo").toEqual([]);
    expect(await pressedScale(page, button(page, "Crear")), "«Crear» pulsado no escala").toBeCloseTo(1, 3);
    await page.waitForTimeout(500);
    await take();
    await dayButton(page, "Hoy", name).click();
    await expect.poll(() => streakValue(page, name)).toBe("3 días");
    await expect.poll(() => marked(api, id)).toContain(today);
    await button(page, `Borrar ${name}`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await take(), "animaciones con reduce (marcar, pulso y diálogo)").toEqual([]);
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click();
  });

  test("anuncio: una región aria-live=polite existe desde la carga sin decir nada de la racha; al marcar dice «Racha actual de <hábito>: 3 días» y al desmarcar «…: 2 días»; la <dl> no cambia", async ({ page, api }) => {
    const { name, id, today } = await seedAndOpen(page, api, [-1, -2]);
    await expect(page.locator('[aria-live="polite"]').first(), "región aria-live=polite en la página desde la carga").toBeAttached();
    await page.waitForTimeout(1000);
    await expect(page.locator("[aria-live]").filter({ hasText: "Racha actual de" }), "al cargar no se anuncia la racha").toHaveCount(0);
    const live = (text: string) => page.locator('[aria-live="polite"]').filter({ hasText: text }).first();

    await dayButton(page, "Hoy", name).click();
    await expect(live(`Racha actual de ${name}: 3 días`)).toBeAttached();
    await expect.poll(() => marked(api, id)).toContain(today);
    await expectStats(page, name, await marked(api, id), today);

    await dayButton(page, "Hoy", name).click();
    await expect(live(`Racha actual de ${name}: 2 días`)).toBeAttached();
    await expect.poll(async () => (await marked(api, id)).includes(today)).toBe(false);
    await expectStats(page, name, await marked(api, id), today);
  });
});

// ---------------------------------------------------------------- Selector de color

const colorGroup = (page: Page) =>
  page.getByRole("radiogroup", { name: "Color" }).or(page.getByRole("group", { name: "Color" })).first();

/** Caja visible de cada color (su <label>: el radio puede ir oculto), agrupada en filas por su borde superior. */
async function colorRows(page: Page) {
  const boxes = await colorGroup(page)
    .getByRole("radio")
    .evaluateAll((els) =>
      els.map((el) => {
        const target = (el as HTMLInputElement).labels?.[0] ?? el.closest("label") ?? el;
        const r = target.getBoundingClientRect();
        return { name: (target.textContent ?? "").trim(), top: r.top, left: r.left };
      }),
    );
  expect(boxes.length, "6 colores").toBe(6);
  const rows: (typeof boxes)[] = [];
  for (const b of boxes) {
    const row = rows.find((r) => Math.abs(r[0].top - b.top) <= 2);
    if (row) row.push(b);
    else rows.push([b]);
  }
  return rows;
}

test.describe("T11b · selector de color", () => {
  test("a 1280×900, los 6 colores en una sola fila", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openApp(page);
    const rows = await colorRows(page);
    expect(rows.map((r) => r.map((b) => b.name)), "filas del selector").toHaveLength(1);
  });

  test("a 375×812, una rejilla ordenada (todas las filas con los mismos colores y en columnas) y sin scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openApp(page);
    const rows = await colorRows(page);
    const names = rows.map((r) => r.map((b) => b.name));
    expect(new Set(rows.map((r) => r.length)).size, `filas del mismo tamaño (sin huérfanos): ${JSON.stringify(names)}`).toBe(1);
    for (const row of rows.slice(1)) {
      for (const [i, b] of row.entries()) expect(Math.abs(b.left - rows[0][i].left), `«${b.name}» en su columna`).toBeLessThanOrEqual(2);
    }
    await expectFitsMobile(page, []);
  });
});
