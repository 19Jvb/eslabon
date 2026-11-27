import { expect, test as anonymous, type Locator, type Page } from "@playwright/test";
import { addDays } from "../src/lib/dates";
import {
  COLORS,
  EASE_OUT,
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
  expectNoSeriousA11yViolations,
  failServerActions,
  families,
  field,
  heading,
  heatmap,
  hue,
  inHue,
  item,
  mark,
  motionOutsideWhitelist,
  moving,
  openApp,
  paint,
  prefix,
  readPreview,
  seed,
  test,
  transitionsOf,
  type Color,
} from "./helpers";

// T11: pulido visual. Solo lo que se puede medir de forma objetiva (estilos computados, cajas, peticiones y contraste
// calculado). El juicio estético (capturas a 375, 768 y 1280 y `impeccable detect`) es del Orquestador.
// Las utilidades de color, tipografía y movimiento están en helpers.ts (las comparte card.spec, de T11b).

/** Peticiones a Google Fonts durante la visita. */
function watchGoogleFonts(page: Page) {
  const hits: string[] = [];
  page.on("request", (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) hits.push(r.url());
  });
  return hits;
}

// ---------------------------------------------------------------- Páginas públicas (sin sesión, sin logins)

const brand = (page: Page) => page.getByRole("heading", { level: 1, name: "Eslabón", exact: true });
const POINTS = ["Marca cada día", "Mira crecer tu racha", "Tus datos son solo tuyos"];

anonymous.describe("T11 · páginas públicas", () => {
  for (const path of ["/", "/login", "/registro"]) {
    anonymous(`1 · ${path}: el h1 en Bricolage Grotesque, el texto y los botones en Instrument Sans (cargadas) y ninguna petición a Google Fonts`, async ({ page }) => {
      const google = watchGoogleFonts(page);
      await page.goto(path);
      const h1 = page.getByRole("heading", { level: 1 }).first();
      await expect(h1).toBeVisible();
      expect(await families(h1), "font-family del h1").toContain("bricolagegrotesque");
      for (const h of await page.locator("h2, h3").all()) {
        expect(await families(h), `font-family del encabezado «${await h.textContent()}»`).toContain("bricolagegrotesque");
      }
      expect(await families(page.locator("body")), "font-family del texto (body)").toContain("instrumentsans");
      expect(await families(page.getByRole("button").first()), "font-family de un botón").toContain("instrumentsans");
      const loaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.toLowerCase().replace(/[^a-z]/g, ""));
      });
      expect(loaded.some((f) => f.includes("bricolagegrotesque")), `Bricolage Grotesque cargada (cargadas: ${loaded})`).toBe(true);
      expect(loaded.some((f) => f.includes("instrumentsans")), `Instrument Sans cargada (cargadas: ${loaded})`).toBe(true);
      await page.waitForLoadState("networkidle");
      expect(google, "peticiones a fonts.googleapis.com / fonts.gstatic.com").toEqual([]);
    });
  }

  anonymous("5 · landing: sin 3 tarjetas (ningún punto va en una caja con fondo, sombra o borde en los 4 lados) y los 3 h2 siguen", async ({ page }) => {
    await page.goto("/");
    for (const title of POINTS) {
      await expect(page.getByRole("heading", { level: 2, name: title, exact: true }), `h2 «${title}»`).toBeVisible();
    }
    const boxes = await page.evaluate((titles) => {
      const h2s = [...document.querySelectorAll("h2")].filter((h) => titles.includes((h.textContent ?? "").trim()));
      let common: Element | null = h2s[0];
      while (common && !h2s.every((h) => common!.contains(h))) common = common.parentElement;
      const found: string[] = [];
      for (const h of h2s) {
        for (let n: Element | null = h; n && n !== common; n = n.parentElement) {
          const s = getComputedStyle(n);
          const sides = ["top", "right", "bottom", "left"].filter(
            (side) => parseFloat(s.getPropertyValue(`border-${side}-width`)) > 0 && !["none", "hidden"].includes(s.getPropertyValue(`border-${side}-style`)),
          );
          const filled = s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent";
          // Tailwind deja capas de sombra transparentes («rgba(0, 0, 0, 0) 0px 0px 0px 0px»): solo cuentan las visibles.
          const shadow = s.boxShadow.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px/g, "").replace(/[\s,]/g, "");
          if (sides.length === 4 || filled || (shadow !== "" && shadow !== "none")) {
            found.push(`«${h.textContent}» en <${n.tagName.toLowerCase()}>: bordes=${sides.length} fondo=${s.backgroundColor} sombra=${s.boxShadow}`);
          }
        }
      }
      return found;
    }, POINTS);
    expect(boxes, "los puntos van como lista ligera, sin cajas").toEqual([]);
  });

  // Actualizado en T11c (criterio nuevo, aprobado por el humano en tasks/todo.md): la fila ya no es «LMXJVSD», sino 7 días
  // que terminan en «Hoy» (las iniciales de una semana fija, sin dígitos). La cadena y el mapa L/X/V, en details.spec.
  anonymous("5 · landing: vista previa estática de «Leer 20 minutos» con 7 días que terminan en «Hoy» (iniciales consecutivas de una semana fija), sin fechas ni controles, oculta (aria-hidden) o role=img con otro nombre", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("img", { name: /^Historial de 12 semanas de/ }), "la vista previa no se anuncia como un mapa real").toHaveCount(0);
    const previews = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-hidden="true"], [role="img"]')]
        .filter((el) => (el.textContent ?? "").includes("Leer 20 minutos"))
        .map((el) => ({
          role: el.getAttribute("role"),
          hidden: el.getAttribute("aria-hidden"),
          label: el.getAttribute("aria-label") ?? "",
          text: (el.textContent ?? "").replace(/\s+/g, ""),
          controls: el.querySelectorAll("button, a, input, select, textarea, [tabindex]").length,
          cells: el.querySelectorAll("*").length,
        })),
    );
    expect(previews.length, "un elemento aria-hidden o role=img que contiene «Leer 20 minutos»").toBeGreaterThan(0);
    const preview = previews[0];
    if (preview.role === "img" && preview.hidden !== "true") {
      expect(preview.label, "nombre de la vista previa").not.toMatch(/^Historial de 12 semanas de/);
      expect(preview.label.trim().length, "role=img con nombre").toBeGreaterThan(0);
    }
    const rest = preview.text.replace("Leer20minutos", "");
    expect(rest, "sin fechas (página estática)").not.toMatch(/\d/);
    const row = (await readPreview(page))!.row.map((d) => d.text);
    expect(row, "una fila de 7 días en una línea que termina en «Hoy»").toHaveLength(7);
    expect(row[6], "el último día es «Hoy»").toBe("Hoy");
    // Como en la app, el penúltimo puede decir «Ayer»; el resto, iniciales seguidas de la semana (L M X J V S D, en ciclo).
    const initials = row.slice(0, row[5] === "Ayer" ? 5 : 6);
    expect(initials.every((d) => "LMXJVSD".includes(d) && d.length === 1), `iniciales: ${row.join(" ")}`).toBe(true);
    const week = "LMXJVSD".repeat(2);
    expect(week.includes(initials.join("")), `iniciales seguidas de una semana: ${row.join(" ")}`).toBe(true);
    expect(preview.controls, "sin botones, enlaces ni elementos enfocables dentro").toBe(0);
    expect(preview.cells, "hay un mapa pequeño (más elementos que el nombre y los 7 días)").toBeGreaterThan(7 + 12);
  });

  anonymous("6 · /icon.svg responde 200 con tipo SVG, las páginas lo enlazan con <link rel=icon> y cargar / no da ningún 404", async ({ page, request }) => {
    const icon = await request.get("/icon.svg");
    expect(icon.status(), "/icon.svg").toBe(200);
    expect(icon.headers()["content-type"] ?? "", "tipo de /icon.svg").toContain("image/svg+xml");
    expect(await icon.text(), "es un SVG").toContain("<svg");

    const missing: string[] = [];
    page.on("response", (r) => {
      if (r.status() === 404) missing.push(r.url());
    });
    page.on("console", (m) => {
      if (m.type() === "error" && /404|favicon/i.test(m.text())) missing.push(`consola: ${m.text()}`);
    });
    for (const path of ["/", "/login"]) {
      await page.goto(path);
      const hrefs = await page.locator('link[rel~="icon"]').evaluateAll((links) => links.map((l) => (l as HTMLLinkElement).href));
      expect(hrefs.some((h) => new URL(h).pathname === "/icon.svg"), `${path}: <link rel="icon"> a /icon.svg (hay: ${hrefs})`).toBe(true);
    }
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(missing, "404 al cargar las páginas").toEqual([]);
  });

  anonymous("6 · la tarjeta de auth (/login) lleva el glifo SVG junto a «Eslabón», decorativo (aria-hidden)", async ({ page }) => {
    await page.goto("/login");
    await expectBrandGlyph(page);
  });

  anonymous("7 · superficies: color-scheme light, ::selection con color propio, caret-color de la paleta y text-underline-offset en los enlaces subrayados", async ({ page }) => {
    await page.goto("/");
    await expect(brand(page)).toBeVisible();
    const surfaces = await page.evaluate(() => {
      const p = document.querySelector("main p") ?? document.querySelector("p")!;
      const sel = getComputedStyle(p, "::selection");
      return { scheme: getComputedStyle(document.documentElement).colorScheme, selection: sel.backgroundColor };
    });
    expect(surfaces.scheme, "color-scheme del <html>").toMatch(/^light( only)?$/);
    expect(surfaces.selection, "::selection sin fondo propio").not.toMatch(/^(rgba\(0, 0, 0, 0\)|transparent)$/);

    for (const path of ["/", "/login", "/registro"]) {
      await page.goto(path);
      const loose = await page.locator("a").evaluateAll((links) =>
        links
          .filter((a) => getComputedStyle(a).textDecorationLine.includes("underline"))
          .filter((a) => getComputedStyle(a).textUnderlineOffset === "auto")
          .map((a) => a.textContent),
      );
      expect(loose, `${path}: enlaces subrayados sin text-underline-offset`).toEqual([]);
    }

    await page.goto("/login");
    const caret = await field(page, "Email").evaluate((el) => {
      const s = getComputedStyle(el);
      return { caret: s.caretColor, color: s.color };
    });
    expect(caret.caret, "caret-color de la paleta (no el del texto, que es lo que da auto)").not.toBe(caret.color);
  });

  // T11b amplía la regla de T11 (aprobado por el humano, tasks/todo.md): en reposo solo se permite la lista blanca
  // (aquí, el feedback al pulsar los botones); con reduce, nada.
  anonymous("8 · en /, /login y /registro solo se mueve la lista blanca de T11b (botones: transform ≤ 160 ms) y con reduce nada", async ({ page }) => {
    for (const path of ["/", "/login", "/registro"]) {
      await page.goto(path);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      expect(await motionOutsideWhitelist(page), `${path}: movimiento fuera de la lista blanca`).toEqual([]);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const path of ["/", "/login", "/registro"]) {
      await page.goto(path);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      expect(await moving(page, ""), `${path} con reduce: elementos con transición o animación`).toEqual([]);
    }
  });

  for (const [path, submit] of [
    ["/login", "Entrar"],
    ["/registro", "Crear cuenta"],
  ] as const) {
    anonymous(`T05-r2 · ${path}: «${submit}» con 500 → el genérico y el campo Email conserva lo escrito`, async ({ page }) => {
      await failServerActions(page);
      await page.goto(path);
      const email = `e2e-${Date.now()}@example.com`;
      await field(page, "Email").fill(email);
      await field(page, "Contraseña").fill("una-contraseña-larga-123");
      await button(page, submit).click();
      await expect(announced(page, GENERIC)).toBeVisible();
      await expect(field(page, "Email"), "el email escrito se pierde tras el 500").toHaveValue(email);
    });
  }
});

/** El glifo de marca: un <svg> aria-hidden en el mismo elemento que «Eslabón» o en su padre. */
async function expectBrandGlyph(page: Page) {
  const word = page.getByText("Eslabón", { exact: true }).first();
  await expect(word).toBeVisible();
  const glyphs = await word.evaluate((el) =>
    [...(el.querySelector("svg") ? [el] : [el.parentElement!])].flatMap((n) =>
      [...n.querySelectorAll("svg")].map((svg) => svg.getAttribute("aria-hidden")),
    ),
  );
  expect(glyphs.length, "un <svg> junto a «Eslabón»").toBeGreaterThan(0);
  expect(glyphs, "el glifo es decorativo (aria-hidden=true)").toContain("true");
}

// ---------------------------------------------------------------- /app (usuario de E2E, la sesión compartida)

test.describe("T11 · /app", () => {
  test.use({ timezoneId: MADRID });
  test.afterEach(async ({ api }) => {
    await cleanUp(api);
  });

  /** Siembra un hábito por color con hoy y hoy−2 marcados (ayer queda sin marcar) y abre /app. */
  async function seedColors(page: Page, api: Parameters<typeof mark>[0], colors: readonly Color[]) {
    const p = prefix();
    const names = colors.map((c) => `${p}-${c}`);
    const ids = await seed(api, ...colors.map((color, i) => ({ name: names[i], color })));
    const today = dayAt(MADRID, new Date());
    for (const id of ids) await mark(api, id, today, addDays(today, -2));
    await openApp(page);
    for (const name of names) await expect(dayButton(page, "Hoy", name)).toHaveAttribute("aria-pressed", "true");
    return names;
  }

  test("1 · /app: h1 en Bricolage Grotesque, texto en Instrument Sans, ninguna petición a Google Fonts, <link rel=icon> y el glifo junto a «Eslabón»", async ({ page }) => {
    const google = watchGoogleFonts(page);
    await openApp(page);
    expect(await families(heading(page)), "font-family del h1").toContain("bricolagegrotesque");
    expect(await families(page.locator("body")), "font-family del texto").toContain("instrumentsans");
    expect(await families(button(page, "Crear")), "font-family del botón «Crear»").toContain("instrumentsans");
    await page.waitForLoadState("networkidle");
    expect(google, "peticiones a Google Fonts").toEqual([]);
    const hrefs = await page.locator('link[rel~="icon"]').evaluateAll((links) => links.map((l) => new URL((l as HTMLLinkElement).href).pathname));
    expect(hrefs, '<link rel="icon"> a /icon.svg').toContain("/icon.svg");
    await expectBrandGlyph(page);
  });

  test("2 · el color del hábito recorre su cadena: el día marcado (texto blanco ≥ 4.5:1) y las celdas cumplidas van en el tono de cada hábito; no cumplido = solo borde", async ({ page, api }) => {
    const names = await seedColors(page, api, COLORS);
    const fills = new Map<Color, string>();
    for (const [i, color] of COLORS.entries()) {
      const name = names[i];
      const hoy = dayButton(page, "Hoy", name);
      await expect(hoy).toHaveAttribute("aria-pressed", "true");
      const fill = await paint(page, await backdrop(hoy));
      fills.set(color, fill.join(","));
      expect(inHue(fill, color), `«Hoy» marcado de ${color}: fondo ${fill} (tono ${hue(fill).toFixed(0)}°) fuera de ${HUES[color]}`).toBe(true);

      const texts = await hoy.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const colors: string[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          // Solo el texto que se ve (no el sr-only con el nombre accesible).
          const box = n.parentElement!.getBoundingClientRect();
          if ((n.textContent ?? "").trim() && box.width > 1 && box.height > 1) colors.push(getComputedStyle(n.parentElement!).color);
        }
        return colors;
      });
      expect(texts.length, "el botón tiene texto (inicial y número)").toBeGreaterThan(0);
      for (const text of texts) {
        const ink = await paint(page, [...(await backdrop(hoy)), text]);
        expect(ink, `texto de «Hoy» de ${color}: blanco`).toEqual([255, 255, 255]);
        expect(contrast(ink, fill), `contraste del texto de «Hoy» de ${color}`).toBeGreaterThanOrEqual(4.5);
      }

      // No marcado (Ayer): sin relleno de color (el mismo fondo que tiene detrás) y con borde.
      const ayer = dayButton(page, "Ayer", name);
      await expect(ayer).toHaveAttribute("aria-pressed", "false");
      const empty = await paint(page, await backdrop(ayer));
      const behind = await paint(page, await backdrop(ayer, false));
      expect(empty, `«Ayer» sin marcar de ${color}: sin relleno`).toEqual(behind);
      const border = await ayer.evaluate((el) => {
        const s = getComputedStyle(el);
        return parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none";
      });
      expect(border, `«Ayer» sin marcar de ${color}: con borde`).toBe(true);

      // Celdas cumplidas del mapa: del tono del hábito y ≥ 3:1 contra lo que tienen detrás (WCAG 1.4.11).
      const done = heatmap(page, name).locator('[data-done="true"]');
      await expect(done).toHaveCount(2);
      for (const cell of await done.all()) {
        const c = await paint(page, await backdrop(cell));
        const around = await paint(page, await backdrop(cell, false));
        expect(inHue(c, color), `celda cumplida de ${color}: ${c} (tono ${hue(c).toFixed(0)}°) fuera de ${HUES[color]}`).toBe(true);
        expect(contrast(c, around), `celda cumplida de ${color} contra su fondo`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(new Set(fills.values()).size, `un fondo distinto por color: ${[...fills.entries()].join(" | ")}`).toBe(COLORS.length);
  });

  test("T08-r1 · WCAG 1.4.11: el borde de las celdas no cumplidas y de las futuras contrasta ≥ 3:1 con su fondo", async ({ page, api }) => {
    const [name] = await seedColors(page, api, ["green"]);
    const heat = heatmap(page, name);
    const cells = [
      heat.locator('[data-done="false"]:not([data-future="true"])').first(),
      heat.locator('[data-future="true"]').first(),
    ];
    // Si hoy es domingo no hay celdas futuras: solo se mide la no cumplida.
    for (const cell of cells) {
      if ((await cell.count()) === 0) continue;
      const day = await cell.getAttribute("data-day");
      const { border, width } = await cell.evaluate((el) => {
        const s = getComputedStyle(el);
        return { border: s.borderTopColor, width: parseFloat(s.borderTopWidth) };
      });
      expect(width, `${day}: tiene borde`).toBeGreaterThan(0);
      const outside = await backdrop(cell, false);
      const inside = await backdrop(cell);
      const line = await paint(page, [...outside, border]);
      for (const [where, layers] of [["fuera", outside], ["dentro", inside]] as const) {
        const bg = await paint(page, layers);
        expect(contrast(line, bg), `${day}: borde ${line} contra el fondo de ${where} ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  for (const width of [768, 1280]) {
    test(`3 · a ${width}×900: la <dl> justo debajo de la fila de días (< 48 px) y el mapa a la derecha, alineado arriba (± 24 px)`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      const [name] = await seedColors(page, api, ["blue"]);
      const row = await union(item(page, name).locator("button[data-day]"));
      const dl = (await item(page, name).locator("dl").boundingBox())!;
      const map = (await heatmap(page, name).boundingBox())!;
      const rowBottom = row.y + row.height;
      expect(dl.y, "la <dl> está debajo de la fila de días").toBeGreaterThanOrEqual(rowBottom - 1);
      expect(dl.y - rowBottom, "hueco entre la fila de días y la <dl>").toBeLessThan(48);
      expect(map.x, "el mapa empieza a la derecha de la fila de días").toBeGreaterThanOrEqual(row.x + row.width);
      expect(map.x, "el mapa empieza a la derecha de la <dl>").toBeGreaterThanOrEqual(dl.x + dl.width - 1);
      expect(Math.abs(map.y - row.y), "el mapa alineado arriba con la fila de días").toBeLessThanOrEqual(24);
    });
  }

  test("3 · a 375×812: apilado (la <dl> y el mapa debajo de la fila de días) y sin scroll horizontal", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const [name] = await seedColors(page, api, ["blue"]);
    const row = await union(item(page, name).locator("button[data-day]"));
    const rowBottom = row.y + row.height;
    for (const [what, part] of [["la <dl>", item(page, name).locator("dl")], ["el mapa", heatmap(page, name)]] as const) {
      const box = (await part.boundingBox())!;
      expect(box.y, `${what} debajo de la fila de días`).toBeGreaterThanOrEqual(rowBottom - 1);
    }
    await expectFitsMobile(page, []);
  });

  test("4 · a 375×812: «Renombrar» y «Borrar» son botones de icono (solo un SVG aria-hidden, sin texto), de 44×44, con title igual a su nombre, y un nombre de ~20 caracteres cabe en una línea", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const name = `${prefix()} beber`;
    expect(name.length).toBeLessThanOrEqual(24);
    await seed(api, { name, color: "amber" });
    await openApp(page);
    for (const label of [`Renombrar ${name}`, `Borrar ${name}`]) {
      const b = button(page, label);
      await expect(b, `botón «${label}» por su rol y su nombre`).toBeVisible();
      await expect(b).toHaveAttribute("title", label);
      const look = await b.evaluate((el) => ({
        text: (el as HTMLElement).innerText.trim(),
        svgs: [...el.querySelectorAll("svg")].map((s) => s.getAttribute("aria-hidden")),
      }));
      expect(look.text, `«${label}» sin texto visible`).toBe("");
      expect(look.svgs.length, `«${label}» con un SVG`).toBe(1);
      expect(look.svgs, `el SVG de «${label}» es aria-hidden`).toEqual(["true"]);
    }
    await expectFitsMobile(page, [`Renombrar ${name}`, `Borrar ${name}`]);
    const lines = await item(page, name)
      .getByText(name, { exact: true })
      .first()
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
      });
    expect(lines, `«${name}» ocupa una sola línea`).toBe(1);
  });

  test("7 · accent-color en los radios y tabular-nums en las cifras de la <dl> y en el número de cada día", async ({ page, api }) => {
    const [name] = await seedColors(page, api, ["violet"]);
    const accent = await page.getByRole("radio", { name: "Verde", exact: true }).evaluate((el) => getComputedStyle(el).accentColor);
    expect(accent, "accent-color del radio").not.toBe("auto");
    const numeric = (target: Locator) =>
      target.evaluate((root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const found: string[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          // Solo las cifras que se ven (no el sr-only con el nombre accesible, que puede llevar números).
          const box = n.parentElement!.getBoundingClientRect();
          if (/\d/.test(n.textContent ?? "") && box.width > 1 && box.height > 1) found.push(getComputedStyle(n.parentElement!).fontVariantNumeric);
        }
        return found;
      });
    const dd = await numeric(item(page, name).locator("dl dd").first());
    expect(dd.length, "la primera cifra de la <dl> tiene un número").toBeGreaterThan(0);
    for (const v of dd) expect(v, "font-variant-numeric de la cifra de la <dl>").toContain("tabular-nums");
    for (const tag of ["Hoy", "Ayer"]) {
      const day = await numeric(dayButton(page, tag, name));
      expect(day.length, `«${tag}» muestra su número`).toBeGreaterThan(0);
      for (const v of day) expect(v, `font-variant-numeric del número de «${tag}»`).toContain("tabular-nums");
    }
  });

  // Reescrito en T11b como lista blanca (la regla de movimiento se amplía con permiso del humano, tasks/todo.md).
  test("8 · movimiento: el relleno del día (background-color ≤ 200 ms con cubic-bezier(0.23, 1, 0.32, 1)) y en reposo nada fuera de la lista blanca de T11b", async ({ page, api }) => {
    const [name] = await seedColors(page, api, ["green"]);
    for (const tag of ["Hoy", "Ayer"]) {
      const all = await transitionsOf(dayButton(page, tag, name));
      const fill = all.find((t) => t.property === "background-color");
      expect(fill, `«${tag}»: transición del relleno (background-color, no «all»): ${JSON.stringify(all)}`).toBeDefined();
      expect(fill!.ms, `«${tag}»: duración del relleno`).toBeLessThanOrEqual(200);
      expect(fill!.curve, `«${tag}»: curva del relleno`).toBe(EASE_OUT);
      const press = all.filter((t) => TRANSFORM.includes(t.property));
      expect(press.length, `«${tag}»: transición de transform para el feedback al pulsar: ${JSON.stringify(all)}`).toBeGreaterThan(0);
      for (const t of press) expect(t.ms, `«${tag}»: ${t.property}`).toBeLessThanOrEqual(160);
    }
    expect(await motionOutsideWhitelist(page), "movimiento fuera de la lista blanca").toEqual([]);
  });

  test("8 · con prefers-reduced-motion: reduce, el botón de día no tiene transición ni animación", async ({ page, api }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const [name] = await seedColors(page, api, ["green"]);
    for (const tag of ["Hoy", "Ayer"]) {
      const s = await dayButton(page, tag, name).evaluate((el) => {
        const c = getComputedStyle(el);
        return { transition: c.transitionDuration, animation: c.animationName, animationDuration: c.animationDuration };
      });
      expect(s.transition.split(",").every((d) => parseFloat(d) === 0), `«${tag}»: transition-duration ${s.transition}`).toBe(true);
      expect(s.animation === "none" || s.animationDuration.split(",").every((d) => parseFloat(d) === 0), `«${tag}»: animación ${s.animation} ${s.animationDuration}`).toBe(true);
    }
    expect(await moving(page, ""), "con reduce no se anima nada").toEqual([]);
  });

  test("T06-r2 · renombrar un hábito ya borrado: el foco nunca pasa por <body> y acaba en el h1", async ({ page, api }) => {
    const name = `${prefix()}-foco`;
    const [id] = await seed(api, { name });
    await openApp(page);
    await button(page, `Renombrar ${name}`).click();
    const input = field(page, "Nuevo nombre");
    await expect(input).toBeFocused();
    await input.fill(`${name}-r`);
    const { error } = await api.from("habits").delete().eq("id", id);
    expect(error).toBeNull();
    // Se vigila el foco a cada mutación del DOM y cada 5 ms desde el Enter hasta que la fila desaparece.
    await page.evaluate(() => {
      const w = window as unknown as { e2eBody: number[]; e2eFocus: string[]; e2eStart: number };
      w.e2eBody = [];
      w.e2eFocus = [];
      w.e2eStart = performance.now();
      const at = () => Math.round(performance.now() - w.e2eStart);
      const check = () => {
        if (document.activeElement === null || document.activeElement === document.body) w.e2eBody.push(at());
      };
      document.addEventListener("focusin", (e) => w.e2eFocus.push(`${(e.target as Element).tagName}@${at()}`), true);
      new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true });
      setInterval(check, 5);
    });
    await page.keyboard.press("Enter");
    await expect(item(page, name), "la fila del hábito borrado desaparece").toHaveCount(0);
    await page.waitForTimeout(1000);
    const { hits, focus } = await page.evaluate(() => {
      const w = window as unknown as { e2eBody: number[]; e2eFocus: string[] };
      return { hits: w.e2eBody, focus: w.e2eFocus };
    });
    expect(hits, `ms (desde el Enter) con el foco en <body>; focusin: ${focus.join(" → ")}`).toEqual([]);
    await expect(heading(page), "el foco acaba en el h1").toBeFocused();
  });

  test("10 · D-11: axe sin serious ni critical en /app con un hábito de cada color y días marcados", async ({ page, api }) => {
    await seedColors(page, api, COLORS);
    await page.waitForTimeout(400);
    await expectNoSeriousA11yViolations(page);
  });
});

/** Caja (en coordenadas del viewport, como boundingBox) que contiene a todos los elementos del locator. */
async function union(locator: Locator) {
  const boxes = await locator.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, r: r.right, b: r.bottom };
    }),
  );
  expect(boxes.length, "7 botones de día").toBe(7);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.r)) - x, height: Math.max(...boxes.map((b) => b.b)) - y };
}
