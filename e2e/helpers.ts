import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { bestStreak, completionRate, currentStreak, heatmapWeeks } from "../src/lib/streak";
import { test as base, expect, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";

export const APP_URL = /\/app\/?$/;
export const LOGIN_URL = /\/login\/?$/;
export const GENERIC = "No se pudo completar. Inténtalo de nuevo.";

export const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
export const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
export const heading = (page: Page) => page.getByRole("heading", { level: 1, name: "Tus hábitos" });
/** D-11: el mensaje tiene que estar en una región anunciada (role="alert" o aria-live). */
export const announced = (page: Page, text: string) =>
  page.locator('[role="alert"], [aria-live]').filter({ hasText: text });

/** Variable de entorno obligatoria. Nunca se imprime su valor. */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (.env.local o el entorno de CI)`);
  return value;
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(APP_URL);
}

/** D-11: 0 violaciones serious o critical. Se excluye el indicador de Next en desarrollo, que no llega a producción. */
export async function expectNoSeriousA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
  const serious = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(serious).toEqual([]);
}

/** D-12: a 375×812, sin scroll horizontal y cada botón principal de 44×44 px o más. */
export async function expectFitsMobile(page: Page, buttons: string[]) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "scroll horizontal a 375 px").toBeLessThanOrEqual(clientWidth);
  for (const name of buttons) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box, `botón «${name}» visible`).not.toBeNull();
    expect(box!.width, `ancho de «${name}»`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `alto de «${name}»`).toBeGreaterThanOrEqual(44);
  }
}

/**
 * D-10: retrasa cada envío (Server Action con cabecera next-action, o POST directo a GoTrue)
 * para que se vea el estado de envío, y devuelve la lista de envíos que salieron.
 */
export async function slowSubmits(page: Page) {
  const sent: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const isSubmit =
      request.method() === "POST" &&
      ((await request.headerValue("next-action")) !== null ||
        /\/auth\/v1\/(token|signup)/.test(request.url()));
    if (isSubmit) {
      sent.push(request.url());
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    await route.continue();
  });
  return sent;
}

/** D-10: cada Server Action responde 500 sin llegar al servidor. */
export async function failServerActions(page: Page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && (await request.headerValue("next-action")) !== null) {
      return route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
    }
    return route.continue();
  });
}

/** D-11: llega al elemento solo con Tab y, si se pide, comprueba que el foco se ve (outline o ring). */
export async function tabTo(page: Page, target: Locator, { checkRing = true } = {}) {
  await expect(target).toBeVisible();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) {
      if (!checkRing) return;
      const focusVisible = await target.evaluate((el) => {
        const s = getComputedStyle(el);
        return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
      });
      expect(focusVisible, "el foco no se ve (ni outline ni ring)").toBe(true);
      return;
    }
  }
  throw new Error("No se llega al elemento con Tab");
}

/**
 * Reescribe el cuerpo de la primera Server Action que lance `trigger` (y solo esa) y devuelve el cuerpo original
 * y la respuesta. Sirve para probar lo que el servidor hace con una petición manipulada.
 */
export async function sendRewrittenAction(
  page: Page,
  trigger: () => Promise<unknown>,
  rewrite: (body: string) => string,
  contentType?: string,
) {
  let original: string | undefined;
  const handler = async (route: Route) => {
    const request = route.request();
    const isAction = request.method() === "POST" && (await request.headerValue("next-action")) !== null;
    if (!isAction || original !== undefined) return route.fallback();
    original = request.postData() ?? "";
    const headers = contentType ? { ...request.headers(), "content-type": contentType } : undefined;
    await route.continue({ postData: rewrite(original), headers });
  };
  await page.route("**/*", handler);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined),
    trigger(),
  ]);
  await page.unroute("**/*", handler);
  return { original: original ?? "", status: response.status(), body: await response.text() };
}

/**
 * Parte ASCII inicial de un mensaje. En las respuestas de peticiones interceptadas, Playwright entrega las tildes
 * con doble codificación («é» → «Ã©»), aunque el navegador las pinta bien: el cuerpo se compara solo con esta parte
 * y el texto completo se comprueba en la UI.
 */
export const asciiPart = (message: string) => message.split(/[^\x20-\x7e]/)[0];

/** Cuerpos que no son FormData ni el objeto esperado (heredado de T06): el servidor responde el genérico, no un 500. */
export const NOT_FORM_DATA = ['["x"]', "[]", "[null]", "[42]"];

// ---------- Usuario de E2E: sesión compartida y datos por la API ----------
// Supuesto: el usuario de E2E es SOLO para los tests. Fuera de una prueba no tiene hábitos, y sample.spec (T09) borra
// TODOS sus hábitos al empezar y al terminar cada test, porque los datos de ejemplo tienen nombres fijos (no «e2e-»).
// La cuenta demo no se toca nunca desde estos tests (solo rls.spec, con sus «e2e-%»).
// Los datos se siembran y se borran por la API, como el propio usuario (RLS), con la publishable key.

type Session = { storageState: Awaited<ReturnType<BrowserContext["storageState"]>>; accessToken: string };

/**
 * Un login por ejecución (Supabase limita los logins por IP): la sesión del navegador y el token de la API
 * se guardan en test-results/ (ignorado por git y vaciado al empezar cada ejecución) y se reutilizan
 * aunque el worker se reinicie tras un fallo, y entre archivos.
 */
export const test = base.extend<{ api: SupabaseClient }, { session: Session }>({
  session: [
    async ({ browser }, provide, workerInfo) => {
      const file = join(workerInfo.project.outputDir, ".auth", "e2e-user.json");
      if (!existsSync(file)) {
        const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL });
        await login(await context.newPage(), env("E2E_USER_EMAIL"), env("E2E_USER_PASSWORD"));
        const { data, error } = await apiClient().auth.signInWithPassword({
          email: env("E2E_USER_EMAIL"),
          password: env("E2E_USER_PASSWORD"),
        });
        if (error) throw new Error(`No se pudo iniciar sesión por la API: ${error.message}`);
        mkdirSync(dirname(file), { recursive: true });
        const session: Session = { storageState: await context.storageState(), accessToken: data.session.access_token };
        writeFileSync(file, JSON.stringify(session));
        await context.close();
      }
      await provide(JSON.parse(readFileSync(file, "utf8")));
    },
    { scope: "worker" },
  ],
  storageState: ({ session }, provide) => provide(session.storageState),
  api: ({ session }, provide) => provide(apiClient(session.accessToken)),
});

/** Cliente de la API con la publishable key: anónimo, o como un usuario si se le pasa su token. */
export function apiClient(accessToken?: string) {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}

/** ilike: también borra lo que un fallo hubiera creado en mayúsculas («E2E-…»). Los check-ins caen en cascada. */
export const cleanUp = (api: SupabaseClient) => api.from("habits").delete().ilike("name", "e2e-%");

/** Deja al usuario de E2E sin ningún hábito (la RLS limita el borrado a los suyos). Solo para el usuario de E2E. */
export async function wipeAll(api: SupabaseClient) {
  const { error } = await api.from("habits").delete().not("id", "is", null);
  if (error) throw new Error(`No se pudieron borrar los hábitos del usuario de E2E: ${error.message}`);
}

/** Inserta en orden (uno tras otro, para que created_at los ordene) y devuelve los id. */
export async function seed(api: SupabaseClient, ...habits: { name: string; color?: string }[]) {
  const ids: string[] = [];
  for (const habit of habits) {
    const { data, error } = await api.from("habits").insert(habit).select("id").single();
    if (error) throw new Error(`No se pudo sembrar «${habit.name}»: ${error.message}`);
    ids.push(data.id);
  }
  return ids;
}

export const prefix = () => `e2e-${Date.now()}`;
export const tooLong = (p: string) => `${p}-`.padEnd(61, "x");

export const item = (page: Page, name: string) =>
  page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
export const alert = (page: Page, text: string) => page.getByRole("alert").filter({ hasText: text });

export async function openApp(page: Page) {
  await page.goto("/app");
  await expect(heading(page)).toBeVisible();
}

// ---------- Días (T07 y T08) ----------

export const MADRID = "Europe/Madrid";

export const dayAt = (timeZone: string, at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);

export const dayButton = (page: Page, tag: string, habit: string) => button(page, `${tag}: ${habit}`);

/**
 * Espera a que «Hoy» sea el día de la zona y lo devuelve. Para no fallar en falso al cruzar la medianoche,
 * vale el día de ahora y el de hace 5 minutos (la página pudo pintarse justo antes).
 */
export async function shownToday(page: Page, habit: string, timeZone: string) {
  const hoy = dayButton(page, "Hoy", habit);
  await expect(hoy, `no hay un botón «Hoy: ${habit}»`).toBeVisible();
  await expect
    .poll(
      async () => {
        const shown = await hoy.getAttribute("data-day", { timeout: 1000 });
        const now = Date.now();
        return shown === dayAt(timeZone, new Date(now)) || shown === dayAt(timeZone, new Date(now - 5 * 60_000));
      },
      { message: `el data-day de «Hoy: ${habit}» no es el día de ${timeZone}` },
    )
    .toBe(true);
  return (await hoy.getAttribute("data-day"))!;
}

export async function marked(api: SupabaseClient, habitId: string) {
  const { data, error } = await api.from("check_ins").select("day").eq("habit_id", habitId).order("day");
  if (error) throw new Error(error.message);
  return data.map((row) => row.day as string);
}

export async function mark(api: SupabaseClient, habitId: string, ...days: string[]) {
  const { error } = await api.from("check_ins").insert(days.map((day) => ({ habit_id: habitId, day })));
  if (error) throw new Error(`No se pudo sembrar el check-in: ${error.message}`);
}

// ---------- Estadísticas y mapa (T08, y T09 con el historial largo) ----------
// Lo esperado sale de src/lib/streak.ts (aprobada en T03) sobre los días reales de la BD y el «hoy» que pinta la app.

export const days = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

/** Lo que tiene que decir la <dl> para esos días marcados y ese «hoy». */
export const expectedStats = (marks: string[], today: string) => ({
  "Racha actual": days(currentStreak(marks, today)),
  "Mejor racha": days(bestStreak(marks)),
  "Últimos 30 días": `${completionRate(marks, today)} %`,
});

/** Los pares <dt>/<dd> de cada <dl> del hábito (tiene que haber una), con los espacios normalizados (vale el espacio duro). */
export const readStats = (page: Page, habit: string) =>
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

export async function expectStats(page: Page, habit: string, marks: string[], today: string) {
  const expected = expectedStats(marks, today);
  await expect
    .poll(() => readStats(page, habit), { message: `una <dl> con las estadísticas de «${habit}»` })
    .toEqual([Object.entries(expected)]);
}

export const heatmap = (page: Page, habit: string) =>
  item(page, habit).getByRole("img", { name: /^Historial de 12 semanas de / });

/**
 * El mapa: role="img" con «Historial de 12 semanas de <hábito>: N de M días cumplidos», 84 celdas [data-day] ocultas
 * (aria-hidden) en 12 columnas (semanas, la última la de hoy) × 7 filas (lunes a domingo), con data-done y data-future.
 */
export async function expectHeatmap(page: Page, habit: string, marks: string[], today: string) {
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

// ---------- Color y tipografía medidos (T11 y T11b) ----------
// Los colores se normalizan con un canvas: Chrome los da en oklch o lab y el canvas los pasa a sRGB y compone la
// transparencia. El contraste se calcula con la fórmula de WCAG 2.x.

export type RGB = [number, number, number];
export const COLORS = ["red", "orange", "amber", "green", "blue", "violet"] as const;
export type Color = (typeof COLORS)[number];
/** Tono (HSL) de cada color del hábito, con margen para el 600 y el 700 de Tailwind (red-700 ≈ 358°, amber-700 ≈ 25°…). */
export const HUES: Record<Color, [number, number]> = {
  red: [345, 368],
  orange: [8, 21],
  amber: [21, 50],
  green: [120, 170],
  blue: [200, 245],
  violet: [250, 290],
};

/** Pinta las capas (de abajo arriba) sobre blanco en un canvas y devuelve el sRGB resultante. */
export function paint(page: Page, layers: string[]): Promise<RGB> {
  return page.evaluate((layers) => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("sin canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1, 1);
    for (const layer of layers) {
      ctx.fillStyle = layer;
      ctx.fillRect(0, 0, 1, 1);
    }
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, layers);
}

/** Fondos de los ancestros del elemento, del <html> hacia abajo (sin el propio elemento si `own` es false). */
export const backdrop = (target: Locator, own = true) =>
  target.evaluate((el, own) => {
    const chain: string[] = [];
    for (let n: Element | null = own ? el : el.parentElement; n; n = n.parentElement) {
      chain.unshift(getComputedStyle(n).backgroundColor);
    }
    return chain;
  }, own);

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: RGB) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
export const hue = ([r, g, b]: RGB) => {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return NaN;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
export const inHue = (rgb: RGB, color: Color) => {
  const [lo, hi] = HUES[color];
  const h = hue(rgb);
  return (h >= lo && h <= hi) || (h + 360 >= lo && h + 360 <= hi);
};

/** La familia tipográfica normalizada para comparar nombres de familias (next/font puede añadir prefijos y sufijos). */
export const families = (target: Locator) =>
  target.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase().replace(/[^a-z]/g, ""));

// ---------- Movimiento (T11, ampliado en T11b con permiso del humano) ----------
// Lista blanca de T11b, todo motion-safe: (1) el relleno del botón de día (colores ≤ 200 ms con la curva EASE_OUT);
// (2) el feedback al pulsar (transform ≤ 160 ms) en los botones; (3) el pulso de la cifra de «Racha actual» cuando sube
// por una acción; (4) la entrada del diálogo de borrar (opacity y transform ≤ 200 ms, más display/overlay para
// @starting-style). En Tailwind 4, `scale-*` usa la propiedad `scale`: cuentan como transform `transform`, `translate`,
// `scale` y `rotate`.

export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
export const TRANSFORM = ["transform", "translate", "scale", "rotate"];
/** Las propiedades de `transition-colors` de Tailwind 4. */
const COLOR_PROPS = [
  "color",
  "background-color",
  "border-color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
  "--tw-gradient-from",
  "--tw-gradient-via",
  "--tw-gradient-to",
];

/** Transiciones del elemento, una por propiedad (las de duración 0 no cuentan), con su duración en ms y su curva. */
export const transitionsOf = (target: Locator) =>
  target.evaluate((el) => {
    const s = getComputedStyle(el);
    const list = (v: string) => v.split(/,(?![^(]*\))/).map((x) => x.trim());
    const ms = (v: string) => parseFloat(v) * (v.endsWith("ms") ? 1 : 1000);
    const durations = list(s.transitionDuration).map(ms);
    const curves = list(s.transitionTimingFunction);
    return list(s.transitionProperty)
      .map((property, i) => ({ property, ms: durations[i % durations.length], curve: curves[i % curves.length] }))
      .filter((t) => t.property !== "none" && t.ms > 0);
  });

/** Elementos (fuera del indicador de Next) con alguna transición o animación. Con reduce tiene que salir vacío. */
export const moving = (page: Page, allowed: string) =>
  page.evaluate((allowed) => {
    const secs = (v: string) => Math.max(...v.split(",").map((s) => parseFloat(s) * (s.trim().endsWith("ms") ? 0.001 : 1)));
    return [...document.querySelectorAll("body *")]
      .filter((el) => !(allowed && el.matches(allowed)) && !el.closest("nextjs-portal"))
      .filter((el) => {
        const s = getComputedStyle(el);
        return secs(s.transitionDuration) > 0 || (s.animationName !== "none" && secs(s.animationDuration) > 0);
      })
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} «${(el.textContent ?? "").trim().slice(0, 30)}» transition=${getComputedStyle(el).transitionDuration}`);
  }, allowed);

/**
 * En reposo, lo que se mueve fuera de la lista blanca: ninguna animación CSS; transiciones solo en botones y enlaces
 * (transform ≤ 160 ms), en los botones de día (además, colores ≤ 200 ms) y en el diálogo (opacity, transform, display
 * y overlay ≤ 200 ms). Devuelve una línea por elemento que se sale.
 */
export const motionOutsideWhitelist = (page: Page) =>
  page.evaluate(
    ({ TRANSFORM, COLOR_PROPS }) => {
      const list = (v: string) => v.split(/,(?![^(]*\))/).map((x) => x.trim());
      const ms = (v: string) => parseFloat(v) * (v.endsWith("ms") ? 1 : 1000);
      const out: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        if (el.closest("nextjs-portal")) continue;
        const s = getComputedStyle(el);
        const durations = list(s.transitionDuration).map(ms);
        const props = list(s.transitionProperty)
          .map((p, i) => ({ p, ms: durations[i % durations.length] }))
          .filter((t) => t.p !== "none" && t.ms > 0);
        const animated = s.animationName !== "none" && Math.max(...list(s.animationDuration).map(ms)) > 0;
        if (!props.length && !animated) continue;
        const day = el.matches("button[data-day]");
        const pressable = el.matches("button, a");
        const dialog = el.closest('dialog, [role="dialog"]') !== null;
        const allowed = (t: { p: string; ms: number }) =>
          (TRANSFORM.includes(t.p) && ((pressable && t.ms <= 160) || (dialog && t.ms <= 200))) ||
          (day && COLOR_PROPS.includes(t.p) && t.ms <= 200) ||
          (dialog && ["opacity", "display", "overlay"].includes(t.p) && t.ms <= 200);
        const bad = props.filter((t) => !allowed(t));
        if (animated || bad.length) {
          const what = `${el.tagName.toLowerCase()}${el.hasAttribute("data-day") ? "[data-day]" : ""} «${(el.textContent ?? "").trim().slice(0, 30)}»`;
          out.push(`${what}: ${animated ? `animation=${s.animationName} ` : ""}${bad.map((t) => `${t.p} ${t.ms}ms`).join(", ")}`);
        }
      }
      return out;
    },
    { TRANSFORM, COLOR_PROPS },
  );

/**
 * Escala del elemento mientras se mantiene pulsado (se suelta fuera, así no hay clic). Primero lo trae al viewport:
 * boundingBox() da coordenadas de página y el ratón no pulsa fuera de lo visible (T18-r1: «Crear» quedó en y=884).
 */
export async function pressedScale(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  const scale = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    let v = 1;
    if (s.scale && s.scale !== "none") v *= parseFloat(s.scale);
    if (s.transform && s.transform !== "none") v *= new DOMMatrix(s.transform).a;
    return v;
  });
  await page.mouse.move(1, 1);
  await page.mouse.up();
  return scale;
}

export type Recorded ={ where: string; dd: number; inDialog: boolean; props: string[]; ms: number };

/**
 * Graba desde la carga, frame a frame, cada animación o transición que arranca (CSS o Web Animations): dónde (etiqueta
 * y texto), en qué <dd> de su <dl> (−1 si no está en una), si está en un diálogo, qué propiedades mueve y cuánto dura
 * en total. Así se ven también los movimientos más cortos que un `evaluate`. Llamar antes de abrir la página.
 */
export async function recordAnimations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { e2eAnims: unknown[] };
    w.e2eAnims = [];
    const seen = new WeakSet<Animation>();
    const kebab = (k: string) => (k.startsWith("--") ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
    const tick = () => {
      for (const a of document.getAnimations()) {
        if (seen.has(a)) continue;
        seen.add(a);
        const effect = a.effect as KeyframeEffect | null;
        const t = effect?.target;
        if (!effect || !t || t.getRootNode() !== document || t.closest("nextjs-portal")) continue;
        const props =
          "transitionProperty" in a
            ? [(a as CSSTransition).transitionProperty]
            : [...new Set(effect.getKeyframes().flatMap((k) => Object.keys(k)))]
                .filter((k) => !["offset", "computedOffset", "easing", "composite"].includes(k))
                .map(kebab);
        const dd = t.closest("dd");
        const dl = t.closest("dl");
        w.e2eAnims.push({
          where: `${t.tagName.toLowerCase()} «${(t.textContent ?? "").trim().slice(0, 30)}»`,
          dd: dd && dl ? [...dl.querySelectorAll("dd")].indexOf(dd) : -1,
          inDialog: t.closest('dialog, [role="dialog"]') !== null,
          props,
          ms: Number(effect.getComputedTiming().activeDuration),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  /** Devuelve lo grabado desde la última llamada y lo vacía. */
  return () =>
    page.evaluate(() => {
      const w = window as unknown as { e2eAnims: Recorded[] };
      return w.e2eAnims.splice(0);
    });
}

/** El texto que se ve (sin el sr-only): cada nodo de texto con su caja. */
export const visibleTexts = (target: Locator) =>
  target.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found: { text: string; top: number; bottom: number; left: number; right: number }[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").trim();
      const box = n.parentElement!.getBoundingClientRect();
      if (!text || box.width <= 1 || box.height <= 1) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      found.push({ text, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
    return found;
  });

// ---------- Vista previa de la landing (T11, rehecha en T11c) ----------

/**
 * Lee la vista previa estática de «/»: el elemento aria-hidden o role=img más externo que contiene «Leer 20 minutos».
 * - `row`: la fila de días (7 textos L…D, «Ayer» u «Hoy» en la misma línea), de izquierda a derecha, con la caja pintada
 *   de cada día (el antepasado más externo con ese mismo texto que tiene fondo o borde) y si está relleno (marcado).
 * - `links`: conectores, elementos reales (no pseudoelementos) sin texto, que se ven, cuyo centro cae entre los centros
 *   de dos días contiguos y dentro de su alto, no más anchos que la distancia entre esos centros y con fondo, borde o SVG.
 * - `labels`: textos L, X y V fuera de la fila de días, con cuántas celdas vacías pequeñas (6–20 px) tienen a su derecha.
 * - T11d: `days` (la caja pintada de cada día de la fila, con sus 4 radios y su relleno en sRGB), `bands` (la caja y el
 *   relleno de cada conector de `links`) y `map` (las celdas del mapa: el grupo más grande de hermanos sin texto, pintados
 *   y de 6–20 px, con su centro y si están rellenas).
 */
export const readPreview = (page: Page) =>
  page.evaluate(() => {
    const root = [...document.querySelectorAll('[aria-hidden="true"], [role="img"]')].find((el) =>
      (el.textContent ?? "").includes("Leer 20 minutos"),
    );
    if (!root) return null;
    const ctx = document.createElement("canvas").getContext("2d")!;
    const onWhite = (color: string) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const own = (el: Element) =>
      [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
    const text = (el: Element) => (el.textContent ?? "").trim();
    const seen = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || getComputedStyle(el).visibility !== "visible") return false;
      let opacity = 1;
      for (let n: Element | null = el; n; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity);
      return opacity > 0.01;
    };
    const painted = (el: Element) => {
      const s = getComputedStyle(el);
      const bg = onWhite(s.backgroundColor).some((c) => c < 250);
      const border = ["top", "right", "bottom", "left"].some(
        (side) => parseFloat(s.getPropertyValue(`border-${side}-width`)) > 0 && s.getPropertyValue(`border-${side}-style`) !== "none",
      );
      return bg || border || el instanceof SVGElement;
    };
    const all = [...root.querySelectorAll("*")].filter(seen);

    const DAY = /^(L|M|X|J|V|S|D|Ayer|Hoy)$/;
    const days = all
      .filter((el) => DAY.test(own(el)))
      .map((el) => {
        let cell = el;
        for (let n = el.parentElement; n && root.contains(n) && n !== root && text(n) === own(el); n = n.parentElement) {
          if (painted(n)) cell = n;
        }
        const r = cell.getBoundingClientRect();
        const s = getComputedStyle(cell);
        const fill = onWhite(s.backgroundColor);
        const radii = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(parseFloat);
        return { el: cell, text: own(el), left: r.left, right: r.right, top: r.top, bottom: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, filled: fill.some((c) => c < 235), fill, radii };
      });
    const rows: (typeof days)[] = [];
    for (const d of days) {
      const row = rows.find((r) => Math.abs(r[0].cy - d.cy) <= 3);
      if (row) row.push(d);
      else rows.push([d]);
    }
    const row = (rows.find((r) => r.length === 7 && r.some((d) => d.text === "Hoy")) ?? []).sort((a, b) => a.cx - b.cx);

    const links = all
      .filter((el) => text(el) === "" && painted(el) && !row.some((d) => el.contains(d.el) || el === d.el))
      .flatMap((el) => {
        const r = el.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const i = row.findIndex((d, k) => k < row.length - 1 && d.cx < cx && cx < row[k + 1].cx);
        if (i < 0 || cy < row[i].top || cy > row[i].bottom || r.width > row[i + 1].cx - row[i].cx + 1) return [];
        return [{ i, left: r.left, right: r.right, top: r.top, bottom: r.bottom, fill: onWhite(getComputedStyle(el).backgroundColor) }];
      });

    const rowTop = Math.min(...row.map((d) => d.top));
    const rowBottom = Math.max(...row.map((d) => d.bottom));
    const isSmall = (el: Element) => {
      const r = el.getBoundingClientRect();
      return text(el) === "" && r.width >= 6 && r.width <= 20 && r.height >= 6 && r.height <= 20;
    };
    const small = all.filter(isSmall);
    const parents = [...new Set(small.filter(painted).map((el) => el.parentElement!))];
    const grid = parents.sort((a, b) => [...b.children].filter((c) => isSmall(c) && painted(c)).length - [...a.children].filter((c) => isSmall(c) && painted(c)).length)[0];
    const map = grid
      ? [...grid.children].filter((c) => seen(c) && isSmall(c) && painted(c)).map((c) => {
          const r = c.getBoundingClientRect();
          return { cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, done: onWhite(getComputedStyle(c).backgroundColor).some((v) => v < 235) };
        })
      : [];
    const labels = all
      .filter((el) => ["L", "X", "V"].includes(own(el)))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cy = (r.top + r.bottom) / 2;
        const cells = small.filter((c) => {
          const b = c.getBoundingClientRect();
          return b.left >= r.right - 0.5 && Math.abs((b.top + b.bottom) / 2 - cy) <= 4;
        }).length;
        return { text: own(el), left: r.left, cy, cells };
      })
      .filter((l) => row.length === 0 || l.cy < rowTop || l.cy > rowBottom);

    return {
      row: row.map((d) => ({ text: d.text, filled: d.filled })),
      links: [...new Set(links.map((l) => l.i))].sort((a, b) => a - b),
      labels,
      days: row.map((d) => ({ label: d.text, left: d.left, right: d.right, top: d.top, bottom: d.bottom, radii: d.radii, fill: d.fill as RGB })),
      bands: links.map(({ left, right, top, bottom, fill }) => ({ left, right, top, bottom, fill: fill as RGB })),
      map,
    };
  });

// ---------- La cadena como banda continua (T11d) ----------

type Box = { left: number; right: number; top: number; bottom: number };
export type ChainDay = Box & { label: string; radii: number[]; fill: RGB };
export type ChainBand = Box & { fill: RGB };

/**
 * Lo que falla en una fila de días frente a cuáles deben ir unidos (`linked[i]`: el día i con el i+1). Unidos: un solo
 * conector entre los dos, de alto ≥ 80 % del botón y sin salirse de él, tocando los dos (±1 px; puede montarse) y con el
 * mismo relleno que ambos (±3 por canal). Esquinas: las interiores de una unión a 0 y el resto como las de un día suelto
 * (> 0). Sin unir: ningún conector. Devuelve una línea por fallo (vacío = bien).
 */
export function chainProblems(days: ChainDay[], bands: ChainBand[], linked: boolean[]) {
  const out: string[] = [];
  const cx = (b: Box) => (b.left + b.right) / 2;
  const cy = (b: Box) => (b.top + b.bottom) / 2;
  const far = (a: RGB, b: RGB) => a.some((v, k) => Math.abs(v - b[k]) > 3);
  for (let i = 0; i < days.length - 1; i++) {
    const [a, b] = [days[i], days[i + 1]];
    const name = `${a.label}→${b.label}`;
    const here = bands.filter((x) => cx(x) > cx(a) && cx(x) < cx(b) && cy(x) >= Math.min(a.top, b.top) && cy(x) <= Math.max(a.bottom, b.bottom));
    if (!linked[i]) {
      if (here.length) out.push(`${name}: sin unir, pero hay ${here.length} conector(es)`);
      continue;
    }
    if (here.length !== 1) {
      out.push(`${name}: ${here.length} conectores visibles (se espera 1)`);
      continue;
    }
    const band = here[0];
    const h = a.bottom - a.top;
    const bh = band.bottom - band.top;
    if (bh < 0.8 * h) out.push(`${name}: el conector mide ${bh.toFixed(1)} px de alto, < 80 % de ${h.toFixed(1)} px`);
    if (band.top < a.top - 1 || band.bottom > a.bottom + 1) out.push(`${name}: el conector se sale del alto del botón`);
    if (band.left > a.right + 1 || band.right < b.left - 1) {
      out.push(`${name}: el conector no toca los dos días (huecos de ${(band.left - a.right).toFixed(1)} y ${(b.left - band.right).toFixed(1)} px)`);
    }
    if (far(band.fill, a.fill) || far(band.fill, b.fill)) out.push(`${name}: relleno del conector ${band.fill} ≠ el de los días ${a.fill} y ${b.fill}`);
  }
  const n = days.length;
  const left0 = (k: number) => k > 0 && linked[k - 1];
  const right0 = (k: number) => k < n - 1 && linked[k];
  const free = days.filter((_, k) => !left0(k) && !right0(k));
  const ref = free[0]?.radii[0];
  if (!(ref > 0)) out.push(`no hay un día suelto con las esquinas redondeadas con el que comparar (radio ${ref})`);
  const corners = ["arriba-izquierda", "arriba-derecha", "abajo-derecha", "abajo-izquierda"];
  days.forEach((d, k) => {
    const want = [left0(k) ? 0 : ref, right0(k) ? 0 : ref, right0(k) ? 0 : ref, left0(k) ? 0 : ref];
    d.radii.forEach((r, j) => {
      if (!(Math.abs(r - want[j]) <= 0.5)) out.push(`${d.label}: esquina ${corners[j]} de ${r} px (se espera ${want[j]} px)`);
    });
  });
  return out;
}
