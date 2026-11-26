import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { addDays } from "../src/lib/dates";
import { bestStreak, currentStreak } from "../src/lib/streak";
import {
  GENERIC,
  MADRID,
  NOT_FORM_DATA,
  alert,
  announced,
  apiClient,
  button,
  dayButton,
  expectFitsMobile,
  expectHeatmap,
  expectNoSeriousA11yViolations,
  expectStats,
  failServerActions,
  item,
  mark,
  openApp,
  prefix,
  readStats,
  seed,
  sendRewrittenAction,
  shownToday,
  slowSubmits,
  tabTo,
  test,
  wipeAll,
} from "./helpers";

// T09: «Cargar datos de ejemplo» y la función public.load_sample_data(p_today date), con el usuario de E2E.
// El usuario de E2E es solo para tests: aquí se borran TODOS sus hábitos antes y después de cada test, porque los
// datos de ejemplo tienen nombres fijos. La cuenta demo no se toca.
// Requisito: la migración de T09 tiene que estar aplicada en el proyecto de Supabase contra el que se prueba.
// «Hoy» de la BD = current_date (UTC). Riesgo que queda: un test que cruce la medianoche UTC entre dos llamadas.
// Límite: el determinismo «en otra cuenta» no se prueba (no hay una tercera cuenta que se pueda borrar); se prueba que
// el patrón solo depende del desplazamiento respecto a p_today (tres p_today distintos, la UI y la API, varias cargas).

const LOAD = "Cargar datos de ejemplo";
const GONE = "Ese hábito ya no existe.";
const EMPTY = "Aún no tienes hábitos";
const SAMPLE = [
  { name: "Beber 2 litros de agua", color: "amber" },
  { name: "Caminar 30 minutos", color: "green" },
  { name: "Leer 20 minutos", color: "blue" },
];
const RPC = "load_sample_data";
/** PostgREST no encuentra una función con esos parámetros. */
const NOT_FOUND = "PGRST202";

test.use({ timezoneId: MADRID });

test.beforeEach(async ({ api }) => {
  await wipeAll(api);
});

test.afterEach(async ({ api }) => {
  await wipeAll(api);
});

// ---------- Datos ----------

const utcToday = () => new Date().toISOString().slice(0, 10);
const offsetOf = (day: string, today: string) => Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000);
const userIdOf = (accessToken: string) =>
  JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString()).sub as string;

type Habit = { id: string; name: string; color: string; userId: string; days: string[]; dayOwners: string[] };

/** Todos los hábitos del usuario de E2E con sus días (ordenados por nombre), leídos de la BD. */
async function readAll(api: SupabaseClient): Promise<Habit[]> {
  const habits = await api.from("habits").select("id, name, color, user_id").order("name");
  if (habits.error) throw new Error(habits.error.message);
  const checkIns = await api.from("check_ins").select("habit_id, day, user_id").order("day");
  if (checkIns.error) throw new Error(checkIns.error.message);
  expect(checkIns.data.length, "menos de 1000 check-ins (max_rows de PostgREST)").toBeLessThan(1000);
  return habits.data.map((h) => {
    const own = checkIns.data.filter((c) => c.habit_id === h.id);
    return {
      id: h.id,
      name: h.name,
      color: h.color,
      userId: h.user_id,
      days: own.map((c) => c.day as string),
      dayOwners: own.map((c) => c.user_id as string),
    };
  });
}

/** El patrón: nombre, color y los días como desplazamientos respecto a «hoy» (−1 = ayer). */
const patternOf = (habits: Habit[], today: string) =>
  habits.map((h) => ({ name: h.name, color: h.color, offsets: h.days.map((d) => offsetOf(d, today)) }));

const load = (client: SupabaseClient, args: Record<string, unknown>) => client.rpc(RPC, args);

/** La función existe con esos parámetros (si no, PostgREST responde PGRST202 y el test no probaría nada). */
function expectFunctionFound(error: { code?: string; message: string } | null, what: string) {
  expect(error?.code, `${what}: la función ${RPC}(p_today) no existe en la BD (${error?.message})`).not.toBe(NOT_FOUND);
}

/**
 * Los criterios de los datos: exactamente los 3 hábitos con su color; unos 60 días de historial, todos antes de «hoy»;
 * algún hueco; rachas actuales variadas; y en al menos uno la mejor racha es mayor que la actual. Devuelve el patrón.
 */
function expectRealistic(habits: Habit[], today: string) {
  expect(habits.map(({ name, color }) => ({ name, color })), "los 3 hábitos de ejemplo con su color").toEqual(SAMPLE);
  for (const h of habits) {
    expect(h.days.length, `«${h.name}» tiene historial`).toBeGreaterThan(0);
    for (const day of h.days) expect(day < today, `«${h.name}»: ${day} no es anterior a hoy (${today})`).toBe(true);
  }
  const earliest = Math.min(...habits.flatMap((h) => h.days.map((d) => offsetOf(d, today))));
  expect(earliest, "unos 60 días de historial (el día más antiguo, entre hoy−70 y hoy−50)").toBeGreaterThanOrEqual(-70);
  expect(earliest, "unos 60 días de historial (el día más antiguo, entre hoy−70 y hoy−50)").toBeLessThanOrEqual(-50);
  const withGap = habits.filter((h) => h.days.length < -offsetOf(h.days[0], today));
  expect(withGap.length, "algún hueco: al menos un hábito con días sin marcar entre su primer día y ayer").toBeGreaterThan(0);
  const streaks = habits.map((h) => ({ name: h.name, current: currentStreak(h.days, today), best: bestStreak(h.days) }));
  expect(new Set(streaks.map((s) => s.current)).size, `rachas variadas: ${JSON.stringify(streaks)}`).toBeGreaterThan(1);
  expect(streaks.some((s) => s.best > s.current), `mejor racha > actual en alguno: ${JSON.stringify(streaks)}`).toBe(true);
  return patternOf(habits, today);
}

// ---------- UI ----------

const loadButton = (page: Page) => button(page, LOAD);
/** Cualquier aviso con texto (genérico, crudo o «ya no existe»). */
const anyAlert = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

async function expectSampleListed(page: Page) {
  for (const { name } of SAMPLE) await expect(item(page, name), `«${name}» en la lista`).toHaveCount(1);
}

/** Abre /app vacío, pulsa el botón y espera a que salgan los 3. Devuelve el «hoy» que pinta la app en esa zona. */
async function loadFromUi(page: Page, zone = MADRID) {
  await openApp(page);
  await loadButton(page).click();
  await expectSampleListed(page);
  return shownToday(page, SAMPLE[0].name, zone);
}

test.describe("el botón en /app", () => {
  test("con 0 hábitos: «Aún no tienes hábitos» y el botón «Cargar datos de ejemplo»; con 1 hábito o más, no aparece", async ({ page, api }) => {
    await openApp(page);
    await expect(page.getByText(EMPTY)).toBeVisible();
    await expect(loadButton(page)).toBeVisible();
    await expect(loadButton(page)).toBeEnabled();

    const name = `${prefix()}-uno`;
    await seed(api, { name });
    await page.reload();
    await expect(item(page, name)).toBeVisible();
    await expect(loadButton(page), "con 1 hábito no hay botón").toHaveCount(0);
  });

  test("pulsarlo → exactamente «Leer 20 minutos» (azul), «Caminar 30 minutos» (verde) y «Beber 2 litros de agua» (ámbar), unos 60 días realistas, Hoy sin marcar y el botón desaparece", async ({ page, api, session }) => {
    const today = await loadFromUi(page);
    const habits = await readAll(api);
    expectRealistic(habits, today);
    for (const h of habits) {
      await expect(dayButton(page, "Hoy", h.name), `Hoy sin marcar en «${h.name}»`).toHaveAttribute("aria-pressed", "false");
      expect(h.userId, "el hábito es del usuario que pulsa (auth.uid())").toBe(userIdOf(session.accessToken));
    }
    await expect(loadButton(page), "con hábitos ya no hay botón").toHaveCount(0);
    await expect(page.getByText(EMPTY)).toBeHidden();
    await expect(anyAlert(page)).toHaveCount(0);
  });

  test("historial largo: las estadísticas y el mapa de los 3 coinciden con streak.ts sobre los ~60 días reales, y alguno muestra «Mejor racha» > «Racha actual»", async ({ page, api }) => {
    const today = await loadFromUi(page);
    const habits = await readAll(api);
    expectRealistic(habits, today);
    for (const h of habits) {
      await expectStats(page, h.name, h.days, today);
      await expectHeatmap(page, h.name, h.days, today);
    }
    const shown = await Promise.all(habits.map((h) => readStats(page, h.name)));
    const number = (pairs: string[][], term: string) => Number(pairs.find(([t]) => t === term)?.[1].split(" ")[0]);
    expect(
      shown.some(([pairs]) => number(pairs, "Mejor racha") > number(pairs, "Racha actual")),
      `la UI muestra una mejor racha mayor que la actual: ${JSON.stringify(shown)}`,
    ).toBe(true);
  });

  test("D-10: con 500 → genérico anunciado, el botón vuelve a estar activo y no se crea nada", async ({ page, api }) => {
    await openApp(page);
    await failServerActions(page);
    await loadButton(page).click();
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(loadButton(page)).toBeEnabled();
    await expect(page.getByText(EMPTY)).toBeVisible();
    expect(await readAll(api)).toEqual([]);
  });

  test("petición manipulada (cuerpo que no es FormData) → sin 500 ni error crudo, y 0 o 3 hábitos (nunca otra cosa)", async ({ page, api }) => {
    for (const junk of NOT_FORM_DATA) {
      await openApp(page);
      const sent = await sendRewrittenAction(page, () => loadButton(page).click(), () => junk, "text/plain;charset=UTF-8");
      expect(sent.status, `${junk}: estado HTTP`).toBe(200);
      expect(sent.body, `${junk}: sin error crudo de la BD`).not.toMatch(/PGRST|violates|duplicate key|permission denied|load_sample_data/i);
      expect([0, 3], `${junk}: hábitos tras la petición`).toContain((await readAll(api)).length);
      await wipeAll(api);
    }
  });
});

test.describe("idempotente", () => {
  test("D-10: doble clic → un solo envío, botón deshabilitado mientras envía y exactamente 3 hábitos, sin error", async ({ page, api }) => {
    await openApp(page);
    const sent = await slowSubmits(page);
    await loadButton(page).dblclick();
    await expect(loadButton(page), "deshabilitado mientras envía").toBeDisabled();
    await expectSampleListed(page);
    expect(sent, "un solo envío").toHaveLength(1);
    expect((await readAll(api)).map((h) => h.name)).toEqual(SAMPLE.map((s) => s.name));
    await expect(anyAlert(page)).toHaveCount(0);
  });

  test("dos pestañas pulsan a la vez → exactamente 3 hábitos y ninguna muestra un error", async ({ page, context, api }) => {
    const other = await context.newPage();
    await openApp(page);
    await openApp(other);
    // Los dos envíos se retienen 1,5 s y salen juntos: así coinciden en el servidor.
    await Promise.all([slowSubmits(page), slowSubmits(other)]);
    await Promise.all([loadButton(page).click(), loadButton(other).click()]);
    for (const tab of [page, other]) {
      await expectSampleListed(tab);
      await expect(anyAlert(tab)).toHaveCount(0);
    }
    expect((await readAll(api)).map((h) => h.name)).toEqual(SAMPLE.map((s) => s.name));
    await other.close();
  });
});

test.describe("marcar sobre los datos de ejemplo (heredado de T08-r1)", () => {
  for (const zone of ["Pacific/Kiritimati", "Pacific/Honolulu"]) {
    test.describe(`navegador en ${zone}`, () => {
      test.use({ timezoneId: zone });

      test(`los días salen relativos al «hoy» de ${zone} (mismo patrón que la API); marcar Hoy en los 3 y hoy−6 sube la racha y nunca dice «${GONE}»`, async ({ page, context, api, baseURL }) => {
        // Patrón de referencia desde la API, con el «hoy» de la BD.
        const reference = utcToday();
        const { error } = await load(api, { p_today: reference });
        expectFunctionFound(error, "carga de referencia");
        expect(error).toBeNull();
        const expected = expectRealistic(await readAll(api), reference);
        await wipeAll(api);

        await context.addCookies([{ name: "tz", value: zone, url: baseURL! }]);
        const today = await loadFromUi(page, zone);
        const habits = await readAll(api);
        expect(patternOf(habits, today), "el mismo patrón, relativo al «hoy» del usuario").toEqual(expected);

        for (const h of habits) await dayButton(page, "Hoy", h.name).click();
        const first = habits[0];
        const oldest = item(page, first.name).locator("button[data-day]").first();
        const oldestDay = (await oldest.getAttribute("data-day"))!;
        expect(oldestDay).toBe(addDays(today, -6));
        await oldest.click();

        await expect
          .poll(async () => (await readAll(api)).map((h) => h.days.includes(today)), { message: "Hoy marcado en la BD" })
          .toEqual([true, true, true]);
        await expect
          .poll(async () => (await readAll(api))[0].days.includes(oldestDay), { message: "hoy−6 cambiado en la BD" })
          .toBe(!first.days.includes(oldestDay));
        await expect(alert(page, GONE), `nunca «${GONE}» en un hábito vivo`).toHaveCount(0);
        await expect(anyAlert(page)).toHaveCount(0);

        const after = await readAll(api);
        for (const [i, h] of after.entries()) {
          await expectStats(page, h.name, h.days, today);
          // hoy−6 solo se tocó en el primero: en los otros dos, marcar Hoy suma exactamente 1 a la racha.
          if (i > 0) expect(currentStreak(h.days, today), `«${h.name}»: la racha sube 1`).toBe(currentStreak(habits[i].days, today) + 1);
        }
      });
    });
  }
});

test.describe("la función load_sample_data (API con la publishable key)", () => {
  test("sin sesión (anon) → 42501 «permission denied» (execute revocado a public y anon)", async () => {
    const { error } = await load(apiClient(), { p_today: utcToday() });
    expectFunctionFound(error, "anon");
    expect(error?.code, error?.message).toBe("42501");
    expect(error?.message).toMatch(/permission denied/i);
  });

  test("p_today fuera de current_date ± 1 (±2, ±5), null o imposible → error y 0 filas", async ({ api }) => {
    const today = utcToday();
    for (const p_today of [addDays(today, 2), addDays(today, -2), addDays(today, 5), addDays(today, -5), null, "2026-02-30", "x"]) {
      const { error } = await load(api, { p_today });
      expectFunctionFound(error, `p_today=${p_today}`);
      expect(error, `p_today=${p_today} tiene que dar error`).not.toBeNull();
      expect(await readAll(api), `p_today=${p_today}: 0 filas`).toEqual([]);
    }
  });

  test("determinista: con p_today = current_date−1, current_date y current_date+1 (y dos veces el mismo), el mismo patrón relativo, todo < p_today y con el user_id de auth.uid()", async ({ api, session }) => {
    const uid = userIdOf(session.accessToken);
    const today = utcToday();
    const patterns: ReturnType<typeof patternOf>[] = [];
    for (const p_today of [addDays(today, -1), today, addDays(today, 1), today]) {
      const { error } = await load(api, { p_today });
      expectFunctionFound(error, `p_today=${p_today}`);
      expect(error, `p_today=${p_today}`).toBeNull();
      const habits = await readAll(api);
      patterns.push(expectRealistic(habits, p_today));
      for (const h of habits) {
        expect(h.userId, "habits.user_id = auth.uid()").toBe(uid);
        expect(new Set(h.dayOwners), "check_ins.user_id = auth.uid()").toEqual(new Set([uid]));
      }
      await wipeAll(api);
    }
    for (const p of patterns.slice(1)) expect(p, "el patrón no depende del día ni de la ejecución").toEqual(patterns[0]);
  });

  test("la firma solo acepta p_today: con un user_id de fuera (user_id, p_user_id, uid, p_uid) → PGRST202 y no se crea nada", async ({ api, session }) => {
    const uid = userIdOf(session.accessToken);
    const ok = await load(api, { p_today: utcToday() });
    expectFunctionFound(ok.error, "con p_today");
    expect(ok.error).toBeNull();
    await wipeAll(api);
    for (const key of ["user_id", "p_user_id", "uid", "p_uid"]) {
      const { error } = await load(api, { p_today: utcToday(), [key]: uid });
      expect(error?.code, `con ${key}: no hay otra firma que acepte un usuario`).toBe(NOT_FOUND);
      expect(await readAll(api), `con ${key}: 0 filas`).toEqual([]);
    }
  });

  test("con hábitos no hace nada: un hábito propio y su check-in siguen igual, sin error; y una segunda carga deja lo mismo", async ({ api }) => {
    const today = utcToday();
    const name = `${prefix()}-propio`;
    const [id] = await seed(api, { name });
    await mark(api, id, today);
    const before = await readAll(api);
    const own = await load(api, { p_today: today });
    expectFunctionFound(own.error, "con un hábito propio");
    expect(own.error, "con hábitos: no hace nada y no da error").toBeNull();
    expect(await readAll(api)).toEqual(before);

    await wipeAll(api);
    expect((await load(api, { p_today: today })).error).toBeNull();
    const loaded = await readAll(api);
    const again = await load(api, { p_today: today });
    expect(again.error, "segunda carga: sin error").toBeNull();
    expect(await readAll(api), "segunda carga: nada cambia").toEqual(loaded);
  });

  test("dos llamadas a la vez (3 veces) → ninguna da error, exactamente 3 hábitos y el mismo historial que una sola carga", async ({ api }) => {
    const today = utcToday();
    const single = await load(api, { p_today: today });
    expectFunctionFound(single.error, "carga simple");
    expect(single.error).toBeNull();
    const expected = expectRealistic(await readAll(api), today);
    await wipeAll(api);
    for (let round = 1; round <= 3; round++) {
      const results = await Promise.all([load(api, { p_today: today }), load(api, { p_today: today })]);
      expect(results.map((r) => r.error), `ronda ${round}: sin error en ninguna`).toEqual([null, null]);
      expect(patternOf(await readAll(api), today), `ronda ${round}: los 3, sin duplicados`).toEqual(expected);
      await wipeAll(api);
    }
  });
});

test.describe("accesibilidad y móvil", () => {
  test("D-11: axe sin serious ni critical en el estado vacío con el botón, y con los 3 hábitos cargados", async ({ page }) => {
    await openApp(page);
    await expect(loadButton(page)).toBeVisible();
    await test.step("vacío con el botón", () => expectNoSeriousA11yViolations(page));
    await loadButton(page).click();
    await expectSampleListed(page);
    await test.step("con los datos de ejemplo", () => expectNoSeriousA11yViolations(page));
  });

  test("D-11: solo con teclado: Tab hasta «Cargar datos de ejemplo» (foco visible) y Enter → los 3 hábitos", async ({ page, api }) => {
    await openApp(page);
    await tabTo(page, loadButton(page));
    await page.keyboard.press("Enter");
    await expectSampleListed(page);
    expect((await readAll(api)).map((h) => h.name)).toEqual(SAMPLE.map((s) => s.name));
  });

  test("D-12: a 375×812, el botón mide 44×44 o más y no hay scroll horizontal, ni vacío ni con los 3 hábitos", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openApp(page);
    await expectFitsMobile(page, [LOAD]);
    await loadButton(page).click();
    await expectSampleListed(page);
    await expectFitsMobile(page, []);
  });
});
