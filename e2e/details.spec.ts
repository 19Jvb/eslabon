import { expect, test as anonymous, type Locator, type Page } from "@playwright/test";
import { addDays } from "../src/lib/dates";
import {
  MADRID,
  TRANSFORM,
  button,
  dayAt,
  expectFitsMobile,
  heatmap,
  item,
  mark,
  openApp,
  prefix,
  pressedScale,
  readPreview,
  seed,
  tabTo,
  test,
  transitionsOf,
  wipeAll,
} from "./helpers";

// T11c: landing y detalles menores. Las páginas públicas, sin sesión y sin logins (nada se envía). /app, con el usuario de
// E2E: lo que siembra empieza por «e2e-» y se borra al terminar; el estado vacío deja al usuario sin hábitos (wipeAll),
// como sample.spec. La cuenta demo no se toca.
// axe (D-11) en las páginas tocadas ya lo cubren landing.spec («/»), auth.spec (/login y /registro), sample.spec (/app
// vacía) y polish.spec (/app con hábitos): no se repite aquí.

const DEMO = "Probar con la cuenta demo";
const POINTS = ["Marca cada día", "Mira crecer tu racha", "Tus datos son solo tuyos"];
const PRIVACY = "Nadie más ve tus hábitos: cada cuenta solo puede leer y editar los suyos.";
const CTA = "Empieza tu cadena";
const EMPTY = "Aún no tienes hábitos. Crea el primero en «Nuevo hábito».";
const link = (page: Page, name: string) => page.getByRole("link", { name, exact: true });
const brand = (page: Page) => page.getByRole("heading", { level: 1, name: "Eslabón", exact: true });
const point = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });

// ---------------------------------------------------------------- Landing

anonymous.describe("T11c · landing", () => {
  anonymous("el h1 lleva un glifo <svg aria-hidden> visible y su nombre accesible sigue siendo exactamente «Eslabón»", async ({ page }) => {
    await page.goto("/");
    const h1 = brand(page);
    await expect(h1).toBeVisible();
    await expect(h1).toHaveAccessibleName("Eslabón");
    const svgs = await h1.locator("svg").evaluateAll((els) =>
      els.map((s) => ({ hidden: s.closest('[aria-hidden="true"]') !== null, w: s.getBoundingClientRect().width, h: s.getBoundingClientRect().height })),
    );
    expect(svgs.length, "un <svg> dentro del h1").toBeGreaterThan(0);
    expect(svgs.every((s) => s.hidden), "el glifo del h1 es aria-hidden").toBe(true);
    expect(svgs.some((s) => s.w > 0 && s.h > 0), "el glifo se ve").toBe(true);
  });

  anonymous("tercer punto: el mismo título «Tus datos son solo tuyos» con el texto exacto «Nadie más ve tus hábitos: cada cuenta solo puede leer y editar los suyos.»", async ({ page }) => {
    await page.goto("/");
    const third = point(page, POINTS[2]);
    await expect(third, "el punto «Tus datos son solo tuyos» en un <li>").toHaveCount(1);
    await expect(third.getByText(PRIVACY, { exact: true })).toBeVisible();
  });

  for (const width of [1280, 375]) {
    anonymous(`a ${width} px: el CTA final «${CTA}» → /registro va después de los 3 puntos en el DOM y en pantalla, y no duplica «Entrar», «Crear cuenta» ni el botón demo`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const cta = link(page, CTA);
      await expect(cta, `un solo enlace «${CTA}»`).toHaveCount(1);
      await expect(cta).toBeVisible();
      const ctaBox = (await cta.boundingBox())!;
      for (const title of POINTS) {
        const li = point(page, title);
        await expect(li, `el punto «${title}» en un <li>`).toHaveCount(1);
        const after = await li.evaluate(
          (el, ctaEl) => (el.compareDocumentPosition(ctaEl as Node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && !el.contains(ctaEl as Node),
          await cta.elementHandle(),
        );
        expect(after, `«${CTA}» va después de «${title}» en el DOM`).toBe(true);
        const box = (await li.boundingBox())!;
        expect(ctaBox.y, `«${CTA}» está más abajo que «${title}» en pantalla`).toBeGreaterThanOrEqual(box.y + box.height - 1);
      }
      for (const name of ["Entrar", "Crear cuenta"]) await expect(link(page, name), `un solo enlace «${name}»`).toHaveCount(1);
      await expect(button(page, DEMO), "un solo botón demo").toHaveCount(1);
      await cta.click();
      await expect(page).toHaveURL(/\/registro\/?$/);
    });
  }

  anonymous(`D-11 · solo con teclado se llega a «${CTA}» (foco visible) y Enter abre /registro`, async ({ page }) => {
    await page.goto("/");
    await tabTo(page, link(page, CTA));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/registro\/?$/);
  });

  anonymous(`D-12 · a 375×812 sin scroll horizontal y «${CTA}» ≥ 44×44`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expectFitsMobile(page, [DEMO]);
    const box = await link(page, CTA).boundingBox();
    expect(box, `«${CTA}» visible`).not.toBeNull();
    expect(box!.width, `ancho de «${CTA}»`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `alto de «${CTA}»`).toBeGreaterThanOrEqual(44);
  });

  anonymous("vista previa: la cadena se dibuja justo entre los días contiguos marcados (al menos un conector visible) y el mapa lleva las etiquetas L, X y V", async ({ page }) => {
    await page.goto("/");
    const preview = await readPreview(page);
    expect(preview, "la vista previa (aria-hidden o role=img con «Leer 20 minutos»)").not.toBeNull();
    const { row, links, labels } = preview!;
    expect(row.map((d) => d.text), "la fila de 7 días que termina en «Hoy»").toHaveLength(7);
    const chain = row.flatMap((d, i) => (i < 6 && d.filled && row[i + 1].filled ? [i] : []));
    const shown = row.map((d) => `${d.text}${d.filled ? "■" : "□"}`).join(" ");
    expect(chain.length, `al menos dos días contiguos marcados (rellenos): ${shown}`).toBeGreaterThan(0);
    expect(links, `conectores (índice del día de la izquierda) justo entre los contiguos marcados: ${shown}`).toEqual(chain);

    for (const text of ["L", "X", "V"]) {
      const found = labels.filter((l) => l.text === text && l.cells >= 3);
      expect(found.length, `etiqueta «${text}» con celdas del mapa a su derecha (encontradas: ${JSON.stringify(labels)})`).toBeGreaterThan(0);
    }
    const [l, x, v] = ["L", "X", "V"].map((t) => labels.find((e) => e.text === t && e.cells >= 3)!);
    expect(l.cy < x.cy && x.cy < v.cy, "L encima de X encima de V").toBe(true);
    expect(Math.max(l.left, x.left, v.left) - Math.min(l.left, x.left, v.left), "L, X y V en la misma columna").toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------- Auth

anonymous.describe("T11c · /login y /registro", () => {
  for (const [path, primary] of [
    ["/login", "Entrar"],
    ["/registro", "Crear cuenta"],
  ] as const) {
    anonymous(`${path}: el enlace del logo «Eslabón» mide 44 px de alto o más (escritorio y 375 px)`, async ({ page }) => {
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 812 });
        await page.goto(path);
        const logo = link(page, "Eslabón");
        await expect(logo, "un enlace «Eslabón»").toHaveCount(1);
        const box = (await logo.boundingBox())!;
        expect(box.height, `a ${width}: alto del enlace del logo`).toBeGreaterThanOrEqual(44);
        expect(box.width, `a ${width}: ancho del enlace del logo`).toBeGreaterThanOrEqual(44);
      }
    });

    anonymous(`${path}: un separador visual «o» (aria-hidden) entre «${primary}» y el botón demo, sin cambiar sus nombres accesibles`, async ({ page }) => {
      await page.goto(path);
      const main = button(page, primary);
      const demo = button(page, DEMO);
      await expect(main).toHaveAccessibleName(primary);
      await expect(demo).toHaveAccessibleName(DEMO);
      const a = (await main.boundingBox())!;
      const b = (await demo.boundingBox())!;
      const separators = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() === "o"))
          .filter((el) => (el.textContent ?? "").trim() === "o")
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { hidden: el.closest('[aria-hidden="true"]') !== null, inButton: el.closest("button") !== null, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
          }),
      );
      const between = separators.filter((s) => s.w > 0 && s.h > 0 && s.top >= a.y + a.height - 1 && s.bottom <= b.y + 1);
      expect(between.length, `un «o» visible entre «${primary}» y el botón demo (encontrados: ${JSON.stringify(separators)})`).toBe(1);
      expect(between[0].hidden, "el «o» es aria-hidden").toBe(true);
      expect(between[0].inButton, "el «o» no está dentro de un botón").toBe(false);
    });
  }
});

// ---------------------------------------------------------------- /app (usuario de E2E)

/** Fondo y los 4 bordes calculados (color, estilo y grosor). Sin cierres: se serializa para evaluate. */
function looks(n: Element) {
  const s = getComputedStyle(n);
  return ["background-color", ...["top", "right", "bottom", "left"].flatMap((side) => [`border-${side}-color`, `border-${side}-style`, `border-${side}-width`])]
    .map((p) => `${p}: ${s.getPropertyValue(p)}`)
    .join("; ");
}

test.describe("T11c · /app", () => {
  test.use({ timezoneId: MADRID });
  test.afterEach(async ({ api }) => {
    await wipeAll(api);
  });

  test(`estado vacío: el texto exacto «${EMPTY}»`, async ({ page, api }) => {
    await wipeAll(api);
    await openApp(page);
    await expect(page.getByText(EMPTY, { exact: true })).toBeVisible();
  });

  test("Renombrar y Borrar: al pulsar bajan a scale 0.97 con una transición de transform ≤ 160 ms; con reduce, ni transición ni escala", async ({ page, api }) => {
    const name = `${prefix()}-pulsar`;
    await seed(api, { name });
    await openApp(page);
    const targets = [button(page, `Renombrar ${name}`), button(page, `Borrar ${name}`)];
    for (const target of targets) {
      const press = (await transitionsOf(target)).filter((t) => TRANSFORM.includes(t.property));
      expect(press.length, `${target}: transición de transform`).toBeGreaterThan(0);
      for (const t of press) expect(t.ms, `${target}: ${t.property}`).toBeLessThanOrEqual(160);
      expect(await pressedScale(page, target), `${target}: escala mientras está pulsado`).toBeCloseTo(0.97, 2);
    }
    await expect(page.getByRole("dialog"), "soltar fuera no abre el diálogo de borrar").toBeHidden();

    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const target of targets) {
      expect(await transitionsOf(target), `${target} con reduce: transiciones`).toEqual([]);
      expect(await pressedScale(page, target), `${target} con reduce: escala al pulsar`).toBeCloseTo(1, 3);
    }
  });

  // Criterio objetivo de «la leyenda reutiliza cellClass(…)»: cada muestra de la leyenda pinta exactamente igual que una
  // celda del mapa del mismo hábito en ese estado (fondo, color, estilo y grosor de los 4 bordes, calculados). La muestra
  // es el elemento sin texto junto al texto de la leyenda (en el mismo contenedor). Si hoy es domingo no hay celdas
  // futuras y «Futuro» no se compara. Que sea una sola fuente en el código se comprueba además en la revisión (D-15).
  test("la leyenda del mapa pinta igual que las celdas: «Cumplido» = celda cumplida, «Sin marcar» = no cumplida, «Futuro» = futura (fondo y bordes computados)", async ({ page, api }) => {
    const name = `${prefix()}-leyenda`;
    const [id] = await seed(api, { name, color: "violet" });
    const today = dayAt(MADRID, new Date());
    await mark(api, id, today, addDays(today, -2));
    await openApp(page);
    const heat = heatmap(page, name);
    await expect(heat.locator('[data-done="true"]')).toHaveCount(2);
    const cells: [RegExp, Locator][] = [
      [/^\s*cumplido\s*$/i, heat.locator(`[data-done="true"]:not([data-day="${today}"])`)],
      [/^\s*sin marcar\s*$/i, heat.locator('[data-done="false"]:not([data-future="true"])')],
      [/^\s*futuro\s*$/i, heat.locator('[data-future="true"]')],
    ];
    for (const [label, cell] of cells) {
      if ((await cell.count()) === 0) continue;
      const text = item(page, name).getByText(label).first();
      await expect(text, `texto de la leyenda ${label}`).toBeVisible();
      const sample = await text.evaluateHandle((el) =>
        [...(el.parentElement?.children ?? [])].find((c) => c !== el && (c.textContent ?? "").trim() === "" && c.getBoundingClientRect().width > 0) ?? null,
      );
      const element = sample.asElement();
      expect(element, `muestra (elemento sin texto junto a ${label})`).not.toBeNull();
      const swatch = await element!.evaluate(looks);
      const target = await cell.first().evaluate(looks);
      expect(swatch, `la muestra de ${label} pinta como la celda`).toBe(target);
    }
  });
});
