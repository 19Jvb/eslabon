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
