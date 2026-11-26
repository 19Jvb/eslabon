import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import {
  GENERIC,
  NOT_FORM_DATA,
  alert,
  announced,
  asciiPart,
  button,
  cleanUp,
  expectFitsMobile,
  expectNoSeriousA11yViolations,
  failServerActions,
  item,
  openApp,
  prefix,
  seed,
  sendRewrittenAction,
  slowSubmits,
  tabTo,
  test,
  tooLong,
} from "./helpers";

// T07: marcar y desmarcar los 7 últimos días, con el usuario de E2E.
// Contrato de la interfaz: cada día es un <button data-day="YYYY-MM-DD" aria-pressed> con nombre «<etiqueta>: <hábito>».
// Riesgo que queda: si un test marca hoy−6 justo al cruzar la medianoche de la zona, el servidor ya lo ve como hoy−7.

const RANGE = "Solo puedes marcar los últimos 7 días.";
const MADRID = "Europe/Madrid";

// El navegador en Madrid salvo donde se dice otra cosa: así el resultado no depende de la zona de la máquina (CI en UTC).
test.use({ timezoneId: MADRID });

test.afterEach(async ({ api }) => {
  await cleanUp(api);
});

// ---------- Fechas calculadas en el test (independientes de src/lib/dates.ts) ----------

const dayAt = (timeZone: string, at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);

function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** «Hoy», «Ayer» o el día de la semana con mayúscula y su número («Lunes 23»). */
function label(day: string, today: string) {
  if (day === today) return "Hoy";
  if (day === addDays(today, -1)) return "Ayer";
  const weekday = new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  return `${weekday[0].toUpperCase()}${weekday.slice(1)} ${Number(day.slice(8))}`;
}

/** Los 7 días editables, de hoy−6 a hoy. */
const week = (today: string) => Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

const dayButton = (page: Page, tag: string, habit: string) => button(page, `${tag}: ${habit}`);

/**
 * Espera a que «Hoy» sea el día de la zona y lo devuelve. Para no fallar en falso al cruzar la medianoche,
 * vale el día de ahora y el de hace 5 minutos (la página pudo pintarse justo antes).
 */
async function shownToday(page: Page, habit: string, timeZone: string) {
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

/** La fila del hábito: 7 <button>, de hoy−6 a hoy, con su data-day, su nombre accesible y aria-pressed. */
async function expectRow(page: Page, habit: string, today: string) {
  const buttons = item(page, habit).locator("button[data-day]");
  await expect(buttons).toHaveCount(7);
  for (const [i, day] of week(today).entries()) {
    await expect(buttons.nth(i)).toHaveAttribute("data-day", day);
    await expect(buttons.nth(i)).toHaveAccessibleName(`${label(day, today)}: ${habit}`);
    await expect(buttons.nth(i)).toHaveAttribute("aria-pressed", /^(true|false)$/);
  }
}

async function marked(api: SupabaseClient, habitId: string) {
  const { data, error } = await api.from("check_ins").select("day").eq("habit_id", habitId).order("day");
  if (error) throw new Error(error.message);
  return data.map((row) => row.day as string);
}

async function mark(api: SupabaseClient, habitId: string, ...days: string[]) {
  const { error } = await api.from("check_ins").insert(days.map((day) => ({ habit_id: habitId, day })));
  if (error) throw new Error(`No se pudo sembrar el check-in: ${error.message}`);
}

/** Lleva la cuenta de Server Actions en vuelo, para saber cuándo se ha asentado la UI. */
function trackActions(page: Page) {
  let pending = 0;
  const isAction = (r: { method(): string; headers(): Record<string, string> }) =>
    r.method() === "POST" && r.headers()["next-action"] !== undefined;
  page.on("request", (r) => void (isAction(r) && pending++));
  page.on("requestfinished", (r) => void (isAction(r) && pending--));
  page.on("requestfailed", (r) => void (isAction(r) && pending--));
  return async () => {
    for (let i = 0; i < 2; i++) {
      await expect.poll(() => pending, { message: "Server Actions sin terminar" }).toBe(0);
      await page.waitForTimeout(800); // por si la UI encadena otro envío al terminar el anterior
    }
  };
}

const pressed = (value: boolean) => String(value);

test.describe("la fila de días", () => {
  test("cada hábito: 7 <button> de hoy−6 a hoy, de izquierda a derecha, con data-day, «Hoy»/«Ayer»/«Lunes 23» y aria-pressed=false", async ({ page, api }) => {
    const p = prefix();
    const habits = [`${p}-uno`, `${p}-dos`];
    await seed(api, ...habits.map((name) => ({ name })));
    await openApp(page);
    for (const habit of habits) {
      const today = await shownToday(page, habit, MADRID);
      await expectRow(page, habit, today);
      const buttons = item(page, habit).locator("button[data-day]");
      const xs: number[] = [];
      for (const [i, day] of week(today).entries()) {
        await expect(buttons.nth(i)).toHaveAttribute("aria-pressed", "false");
        // Visualmente: la inicial y el número del día.
        await expect(buttons.nth(i)).toContainText(String(Number(day.slice(8))));
        xs.push((await buttons.nth(i).boundingBox())!.x);
      }
      expect(xs, "de izquierda a derecha: hoy−6 … hoy").toEqual([...xs].sort((a, b) => a - b));
      expect(new Set(xs).size, "cada día en su sitio").toBe(7);
    }
  });

  test("los días marcados en la BD salen con aria-pressed=true y el resto false", async ({ page, api }) => {
    const habit = `${prefix()}-pintado`;
    const [id] = await seed(api, { name: habit });
    const today = dayAt(MADRID, new Date());
    await mark(api, id, today, addDays(today, -2), addDays(today, -6));
    await openApp(page);
    const shown = await shownToday(page, habit, MADRID);
    const buttons = item(page, habit).locator("button[data-day]");
    const marks = await marked(api, id);
    for (const [i, day] of week(shown).entries()) {
      await expect(buttons.nth(i), day).toHaveAttribute("aria-pressed", pressed(marks.includes(day)));
    }
  });
});

test.describe("marcar y desmarcar", () => {
  test("al instante (optimista): marcar Hoy, Ayer y hoy−6 guarda esos days en la BD y persiste al recargar; desmarcar borra", async ({ page, api }) => {
    const habit = `${prefix()}-correr`;
    const [id] = await seed(api, { name: habit });
    await openApp(page);
    const today = await shownToday(page, habit, MADRID);
    const oldest = addDays(today, -6);
    const sent = await slowSubmits(page);

    await dayButton(page, "Hoy", habit).click();
    // El envío tarda 1,5 s: si cambia antes, es la UI optimista.
    await expect(dayButton(page, "Hoy", habit)).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
    await dayButton(page, "Ayer", habit).click();
    await dayButton(page, label(oldest, today), habit).click();
    await expect.poll(() => marked(api, id)).toEqual([oldest, addDays(today, -1), today]);
    expect(sent.length, "un envío por clic").toBe(3);

    await page.reload();
    for (const day of week(today)) {
      const on = [oldest, addDays(today, -1), today].includes(day);
      await expect(dayButton(page, label(day, today), habit), day).toHaveAttribute("aria-pressed", pressed(on));
    }

    await dayButton(page, "Ayer", habit).click();
    await expect(dayButton(page, "Ayer", habit)).toHaveAttribute("aria-pressed", "false", { timeout: 1000 });
    await expect.poll(() => marked(api, id)).toEqual([oldest, today]);
    await page.reload();
    await expect(dayButton(page, "Ayer", habit)).toHaveAttribute("aria-pressed", "false");
    await expect(dayButton(page, "Hoy", habit)).toHaveAttribute("aria-pressed", "true");
  });

  test("idempotente: marcar un día que ya estaba marcado (23505) o desmarcar uno ya borrado no da error", async ({ page, api }) => {
    const habit = `${prefix()}-otra-pestana`;
    const [id] = await seed(api, { name: habit });
    await openApp(page);
    const today = await shownToday(page, habit, MADRID);
    const hoy = dayButton(page, "Hoy", habit);

    // Otra pestaña lo marcó: esta sigue viéndolo sin marcar e intenta marcarlo.
    await mark(api, id, today);
    await Promise.all([page.waitForResponse((r) => r.request().headers()["next-action"] !== undefined), hoy.click()]);
    await expect(hoy).toHaveAttribute("aria-pressed", "true");
    await expect(alert(page, GENERIC)).toHaveCount(0);
    expect(await marked(api, id)).toEqual([today]);

    // Otra pestaña lo desmarcó: esta lo ve marcado e intenta desmarcarlo.
    await api.from("check_ins").delete().eq("habit_id", id);
    await Promise.all([page.waitForResponse((r) => r.request().headers()["next-action"] !== undefined), hoy.click()]);
    await expect(hoy).toHaveAttribute("aria-pressed", "false");
    await expect(alert(page, GENERIC)).toHaveCount(0);
    expect(await marked(api, id)).toEqual([]);
  });

  test("D-10: tras un doble clic y un triple clic rápidos, la UI coincide con la BD (antes y después de recargar)", async ({ page, api }) => {
    const habit = `${prefix()}-rapido`;
    const [id] = await seed(api, { name: habit });
    const settled = trackActions(page);
    await openApp(page);
    const today = await shownToday(page, habit, MADRID);
    const hoy = dayButton(page, "Hoy", habit);
    for (const clickCount of [2, 3]) {
      await hoy.click({ clickCount });
      await settled();
      const inDb = (await marked(api, id)).includes(today);
      await expect(hoy, `${clickCount} clics: la UI no coincide con la BD`).toHaveAttribute("aria-pressed", pressed(inDb));
      await page.reload();
      await expect(hoy, `${clickCount} clics, al recargar`).toHaveAttribute("aria-pressed", pressed(inDb));
    }
  });

  test("D-10: con 500, marcar y desmarcar vuelven al estado anterior y sale el genérico en role=alert; la BD no cambia", async ({ page, api }) => {
    const habit = `${prefix()}-fallo`;
    const [id] = await seed(api, { name: habit });
    await openApp(page);
    const today = await shownToday(page, habit, MADRID);
    const hoy = dayButton(page, "Hoy", habit);
    await failServerActions(page);

    await hoy.click();
    await expect(alert(page, GENERIC)).toBeVisible();
    await expect(hoy).toHaveAttribute("aria-pressed", "false");
    expect(await marked(api, id)).toEqual([]);

    await mark(api, id, today);
    await page.reload();
    await expect(hoy).toHaveAttribute("aria-pressed", "true");
    await hoy.click();
    await expect(alert(page, GENERIC)).toBeVisible();
    await expect(hoy).toHaveAttribute("aria-pressed", "true");
    expect(await marked(api, id)).toEqual([today]);
  });
});

test.describe("el servidor valida el día (cuerpo de la Server Action manipulado)", () => {
  test("futuro, hoy−7 y «2026-02-30» → «Solo puedes marcar los últimos 7 días.», la UI vuelve atrás y la BD no cambia", async ({ page, api }) => {
    const habit = `${prefix()}-trampa`;
    const [id] = await seed(api, { name: habit });
    await openApp(page);
    const today = await shownToday(page, habit, MADRID);
    const hoy = dayButton(page, "Hoy", habit);
    for (const bad of [addDays(today, 1), addDays(today, -7), "2026-02-30"]) {
      const sent = await sendRewrittenAction(page, () => hoy.click(), (body) => body.split(today).join(bad));
      expect(sent.original, "el cuerpo de la acción lleva el día como 'YYYY-MM-DD'").toContain(today);
      expect(sent.status, `${bad}: estado HTTP`).toBe(200);
      expect(sent.body, `${bad}: respuesta`).toContain(asciiPart(RANGE));
      await expect(hoy, `${bad}: la UI vuelve atrás`).toHaveAttribute("aria-pressed", "false");
      await expect(alert(page, RANGE).or(alert(page, GENERIC)).first(), `${bad}: error en español anunciado`).toBeVisible();
    }
    expect(await marked(api, id)).toEqual([]);
  });

  test("cuerpos que no son el esperado (['x'], [], [null], [42]) → error en español, no un 500, y la BD no cambia", async ({ page, api }) => {
    const habit = `${prefix()}-basura`;
    const [id] = await seed(api, { name: habit });
    await openApp(page);
    await shownToday(page, habit, MADRID);
    const hoy = dayButton(page, "Hoy", habit);
    for (const junk of NOT_FORM_DATA) {
      const sent = await sendRewrittenAction(page, () => hoy.click(), () => junk, "text/plain;charset=UTF-8");
      expect(sent.status, `${junk}: estado HTTP`).toBe(200);
      expect([GENERIC, RANGE].some((m) => sent.body.includes(asciiPart(m))), `${junk}: respuesta ${sent.body.slice(0, 200)}`).toBe(true);
      await expect(alert(page, RANGE).or(alert(page, GENERIC)).first(), `${junk}: error en español anunciado`).toBeVisible();
      await expect(hoy, `${junk}: la UI vuelve atrás`).toHaveAttribute("aria-pressed", "false");
    }
    expect(await marked(api, id)).toEqual([]);
  });
});

test.describe("zona horaria", () => {
  for (const zone of ["Pacific/Kiritimati", "Pacific/Honolulu"]) {
    test.describe(`navegador en ${zone}`, () => {
      test.use({ timezoneId: zone });

      test(`sin cookie previa: el cliente guarda tz=${zone} (path=/, SameSite=Lax, 1 año), «Hoy» es el día de esa zona sin recargar a mano, y marcar Hoy y hoy−6 guarda esos días`, async ({ page, api, context }) => {
        const habit = `${prefix()}-zona`;
        const [id] = await seed(api, { name: habit });
        await context.clearCookies({ name: "tz" });
        await openApp(page);
        const today = await shownToday(page, habit, zone);
        await expectRow(page, habit, today);

        const cookie = (await context.cookies()).find((c) => c.name === "tz");
        expect(cookie, "cookie tz").toBeDefined();
        expect(decodeURIComponent(cookie!.value)).toBe(zone);
        expect(cookie!.path).toBe("/");
        expect(cookie!.sameSite).toBe("Lax");
        const days = (cookie!.expires * 1000 - Date.now()) / 86_400_000;
        expect(days, "caduca en 1 año").toBeGreaterThan(360);
        expect(days, "caduca en 1 año").toBeLessThan(370);

        // El servidor valida con la zona de la cookie: en una de las dos zonas, Hoy o hoy−6 está fuera del rango de Madrid.
        await dayButton(page, "Hoy", habit).click();
        await dayButton(page, label(addDays(today, -6), today), habit).click();
        await expect.poll(() => marked(api, id)).toEqual([addDays(today, -6), today]);
        await expect(alert(page, RANGE)).toHaveCount(0);
      });
    });
  }

  test.describe("lo que pinta el servidor (sin JavaScript)", () => {
    test.use({ javaScriptEnabled: false });

    // Kiritimati (UTC+14) y Honolulu (UTC−10) siempre están en días distintos: si el servidor ignorara la cookie, uno fallaría.
    for (const zone of ["Pacific/Kiritimati", "Pacific/Honolulu"]) {
      test(`cookie tz=${zone} → «Hoy» y la fila son los de esa zona`, async ({ page, api, context, baseURL }) => {
        const habit = `${prefix()}-cookie`;
        await seed(api, { name: habit });
        await context.addCookies([{ name: "tz", value: zone, url: baseURL! }]);
        await openApp(page);
        await expectRow(page, habit, await shownToday(page, habit, zone));
      });
    }

    for (const [why, value] of [
      ["sin cookie", null],
      ["cookie no válida", "Marte/Olympus"],
      ["cookie vacía", ""],
    ] as const) {
      test(`${why} → Europe/Madrid`, async ({ page, api, context, baseURL }) => {
        const habit = `${prefix()}-madrid`;
        await seed(api, { name: habit });
        await context.clearCookies({ name: "tz" });
        if (value !== null) await context.addCookies([{ name: "tz", value, url: baseURL! }]);
        await openApp(page);
        await expectRow(page, habit, await shownToday(page, habit, MADRID));
      });
    }
  });
});

test.describe("accesibilidad y móvil", () => {
  test("D-11: axe sin serious ni critical con la fila de días (con días marcados)", async ({ page, api }) => {
    const p = prefix();
    const [id] = await seed(api, { name: `${p}-uno`, color: "red" }, { name: `${p}-dos`, color: "violet" });
    const today = dayAt(MADRID, new Date());
    await mark(api, id, today, addDays(today, -3));
    await openApp(page);
    await shownToday(page, `${p}-uno`, MADRID);
    await expectNoSeriousA11yViolations(page);
  });

  test("D-11: marcar con Espacio y desmarcar con Enter solo con teclado, con el foco visible y sin perderlo", async ({ page, api }) => {
    const habit = `${prefix()}-teclado`;
    const [id] = await seed(api, { name: habit });
    await openApp(page);
    const today = await shownToday(page, habit, MADRID);
    const hoy = dayButton(page, "Hoy", habit);
    await tabTo(page, hoy);
    await page.keyboard.press("Space");
    await expect(hoy).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => marked(api, id)).toEqual([today]);
    await expect(hoy, "el foco sigue en el botón tras marcar").toBeFocused();
    await page.keyboard.press("Enter");
    await expect(hoy).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => marked(api, id)).toEqual([]);
    await expect(hoy, "el foco sigue en el botón tras desmarcar").toBeFocused();
    await expect(announced(page, GENERIC)).toHaveCount(0);
  });

  test("D-12: a 375×812, con un nombre de 60 caracteres, la fila cabe sin scroll horizontal y cada día mide ≥ 44×44", async ({ page, api }) => {
    const habit = tooLong(prefix()).slice(0, 60);
    await seed(api, { name: habit });
    await page.setViewportSize({ width: 375, height: 812 });
    await openApp(page);
    const today = await shownToday(page, habit, MADRID);
    await expectFitsMobile(page, week(today).map((day) => `${label(day, today)}: ${habit}`));
  });
});
