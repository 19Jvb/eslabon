import { expect, request as playwrightRequest, type Page } from "@playwright/test";
import { type SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "../src/lib/dates";
import {
  GENERIC,
  LOGIN_URL,
  MADRID,
  NOT_FORM_DATA,
  alert,
  apiClient,
  asciiPart,
  chainProblems,
  cleanUp,
  dayAt,
  dayButton,
  expectFitsMobile,
  expectNoSeriousA11yViolations,
  expectedStats,
  failServerActions,
  inHue,
  item,
  mark,
  marked,
  openApp,
  prefix,
  readStats,
  seed,
  sendRewrittenAction,
  shownToday,
  slowSubmits,
  statsIn,
  tabTo,
  test,
  tooLong,
  trackActions,
  visibleTexts,
  type ChainBand,
  type ChainDay,
  type Color,
  type RGB,
} from "./helpers";

// T22: la página de historial de cada hábito, /app/habitos/<id>?mes=YYYY-MM, con un calendario mensual en el que se
// marca cualquier día desde el 2000-01-01 hasta hoy. Con el usuario de E2E (lo sembrado empieza por «e2e-» y se borra al
// terminar) y el navegador en Madrid. El «otro usuario» del 404 se registra por la API (e2e+historial-…@example.com,
// como los registros de auth.spec). La cuenta demo no se toca.
// Contrato de la interfaz: cada día del mes hasta hoy es un <button aria-pressed> con el número visible y el nombre
// «<d> de <mes>» («, hoy» en el de hoy); los conectores de la cadena son los [data-link] de la tarjeta (T11b/T11d).

const RANGE = "Solo puedes marcar días desde el 1 de enero de 2000 hasta hoy.";
const NOT_FOUND = "No encontramos ese hábito.";
const NO_SESSION = { cookies: [], origins: [] };
const WEEK = ["L", "M", "X", "J", "V", "S", "D"];

test.use({ timezoneId: MADRID });

test.afterEach(async ({ api }) => {
  await cleanUp(api);
});

// ---------- Meses y días calculados en el test ----------

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const iso = (month: string, d: number) => `${month}-${String(d).padStart(2, "0")}`;
const monthName = (month: string) =>
  new Intl.DateTimeFormat("es-ES", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
/** «Noviembre de 2026». */
const monthTitle = (month: string) => {
  const name = monthName(month);
  return `${name[0].toUpperCase()}${name.slice(1)} de ${month.slice(0, 4)}`;
};
/** 0 = lunes … 6 = domingo. */
const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
/** El primer lunes del mes a partir del día 8: él y el martes siguiente están en la misma fila. */
const aMonday = (month: string) => Array.from({ length: 7 }, (_, i) => 8 + i).find((d) => weekday(iso(month, d)) === 0)!;

const historyUrl = (id: string, mes?: string) => `/app/habitos/${id}${mes === undefined ? "" : `?mes=${mes}`}`;
const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const h2 = (page: Page, month: string) => page.getByRole("heading", { level: 2, name: monthTitle(month), exact: true });
const link = (page: Page, name: string) => page.getByRole("link", { name, exact: true });
const dayName = (month: string, d: number, today: string) =>
  `${d} de ${monthName(month)}${iso(month, d) === today ? ", hoy" : ""}`;
const dayIn = (page: Page, month: string, d: number, today: string) =>
  page.getByRole("button", { name: dayName(month, d, today), exact: true });
/** Todos los botones de día de ese mes (con o sin «, hoy»). */
const monthButtons = (page: Page, month: string) =>
  page.getByRole("button", { name: new RegExp(`^\\d{1,2} de ${monthName(month)}(, hoy)?$`) });

async function openHistory(page: Page, id: string, name: string, mes?: string) {
  const response = await page.goto(historyUrl(id, mes));
  await expect(h1(page, name), `h1 «${name}»`).toBeVisible();
  return response;
}

/** Siembra un hábito (y sus días) y devuelve su nombre, su id, el «hoy» de Madrid, el mes de hoy y el anterior. */
async function seedHabit(api: SupabaseClient, days: string[] = [], color: Color = "blue", tag = "historial") {
  const name = `${prefix()}-${tag}`;
  const [id] = await seed(api, { name, color });
  if (days.length) await mark(api, id, ...days);
  const today = dayAt(MADRID, new Date());
  const current = today.slice(0, 7);
  return { name, id, today, current, previous: shiftMonth(current, -1) };
}

async function expectPageStats(page: Page, marks: string[], today: string) {
  await expect
    .poll(() => statsIn(page.locator("body")), { message: "una sola <dl> con «Racha actual», «Mejor racha» y «Últimos 30 días»" })
    .toEqual([Object.entries(expectedStats(marks, today))]);
}

/** Caja, esquinas y relleno (sobre blanco) de los días 1…last del mes, y los [data-link] que se ven. */
async function readCalendar(page: Page, month: string, last: number, today: string) {
  const days: (ChainDay & { d: number })[] = [];
  for (let d = 1; d <= last; d++) {
    const info = await dayIn(page, month, d, today).evaluate((el) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1, 1);
      const s = getComputedStyle(el);
      ctx.fillStyle = s.backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        radii: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(parseFloat),
        fill: [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)],
      };
    });
    days.push({ ...info, d, label: iso(month, d), fill: info.fill as RGB });
  }
  const bands = await page.locator("[data-link]").evaluateAll((els) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const seen = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || getComputedStyle(el).visibility !== "visible") return false;
      let opacity = 1;
      for (let n: Element | null = el; n; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity);
      return opacity > 0.01;
    };
    return els.filter(seen).map((el) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = getComputedStyle(el).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, fill: [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)] };
    });
  });
  return { days, bands: bands.map((b) => ({ ...b, fill: b.fill as RGB })) as ChainBand[] };
}

/** Los fallos de la cadena, semana a semana (cada fila del calendario), frente a los días marcados. Vacío = bien. */
async function calendarProblems(page: Page, month: string, last: number, today: string, marks: string[]) {
  const { days, bands } = await readCalendar(page, month, last, today);
  const on = new Set(marks);
  const rows: (typeof days)[] = [];
  for (const day of days) {
    const row = rows.find((r) => Math.abs(r[0].top - day.top) <= 2);
    if (row) row.push(day);
    else rows.push([day]);
  }
  return rows.flatMap((row) => {
    row.sort((a, b) => a.left - b.left);
    const linked = row.slice(0, -1).map((day, i) => on.has(day.label) && on.has(row[i + 1].label));
    return chainProblems(row, bands, linked);
  });
}

/** Otro usuario, registrado por la API, con un hábito suyo. La cuenta se queda (como en auth.spec); el hábito se borra. */
async function otherUsersHabit() {
  const client = apiClient();
  const { data, error } = await client.auth.signUp({
    email: `e2e+historial-${Date.now()}@example.com`,
    password: `e2e-${crypto.randomUUID()}`,
  });
  if (error || !data.session) throw new Error(`No se pudo registrar al otro usuario: ${error?.message ?? "sin sesión"}`);
  const other = apiClient(data.session.access_token);
  const name = `${prefix()}-de-otro`;
  const [id] = await seed(other, { name });
  return { other, id, name };
}

// ---------------------------------------------------------------- El enlace de la tarjeta

test.describe("el enlace «Historial» de la tarjeta", () => {
  test("cada tarjeta: un enlace con el texto visible «Historial» y el nombre «Ver el historial de <nombre>» a /app/habitos/<id>, que lleva a la página", async ({ page, api }) => {
    const p = prefix();
    const names = [`${p}-uno`, `${p}-dos`];
    const ids = await seed(api, ...names.map((name) => ({ name })));
    await openApp(page);
    for (const [i, name] of names.entries()) {
      const to = item(page, name).getByRole("link", { name: `Ver el historial de ${name}`, exact: true });
      await expect(to, `enlace de «${name}»`).toBeVisible();
      await expect(to).toHaveAttribute("href", `/app/habitos/${ids[i]}`);
      expect((await visibleTexts(to)).map((t) => t.text).join(" "), "texto visible").toBe("Historial");
    }
    await item(page, names[1]).getByRole("link", { name: `Ver el historial de ${names[1]}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/habitos/${ids[1]}$`));
    await expect(h1(page, names[1])).toBeVisible();
  });
});

// ---------------------------------------------------------------- La página

test.describe("la página de historial", () => {
  test("título «Historial de <nombre>», h1 con el nombre, la <dl> de estadísticas igual que la de la tarjeta y «Volver a tus hábitos» → /app", async ({ page, api }) => {
    const today = dayAt(MADRID, new Date());
    const days = [0, -1, -2, -10, -40].map((n) => addDays(today, n));
    const { name, id } = await seedHabit(api, days);
    await openApp(page);
    await shownToday(page, name, MADRID);
    const card = await readStats(page, name);

    await openHistory(page, id, name);
    await expect(page).toHaveTitle(new RegExp(`^Historial de ${name}( · Eslabón)?$`));
    await expectPageStats(page, await marked(api, id), today);
    expect(await statsIn(page.locator("body")), "las mismas cifras que la tarjeta").toEqual(card);

    await link(page, "Volver a tus hábitos").click();
    await expect(page).toHaveURL(/\/app\/?$/);
    await expect(item(page, name)).toBeVisible();
  });

  test("sin ?mes= o con un ?mes= no válido o fuera de rango → el mes de hoy en el h2 («Noviembre de 2026»), con «Mes anterior» y sin «Mes siguiente»", async ({ page, api }) => {
    const { name, id, current } = await seedHabit(api);
    const year = current.slice(0, 4);
    for (const mes of [undefined, "", "abc", `${year}-13`, `${year}-00`, `${year}-1`, `${current}-01`, "1999-12", shiftMonth(current, 1), "9999-01"]) {
      await openHistory(page, id, name, mes);
      await expect(h2(page, current), `?mes=${mes}: el mes de hoy`).toBeVisible();
      await expect(link(page, "Mes anterior"), `?mes=${mes}`).toBeVisible();
      await expect(link(page, "Mes siguiente"), `?mes=${mes}: no hay mes siguiente en el de hoy`).toHaveCount(0);
    }
  });

  test("«Mes anterior» y «Mes siguiente» navegan con ?mes=YYYY-MM; en enero de 2000 no hay «Mes anterior»", async ({ page, api }) => {
    const { name, id, current, previous } = await seedHabit(api);
    await openHistory(page, id, name);
    await link(page, "Mes anterior").click();
    await expect(page).toHaveURL(new RegExp(`/app/habitos/${id}\\?mes=${previous}$`));
    await expect(h2(page, previous)).toBeVisible();
    await link(page, "Mes siguiente").click();
    await expect(page).toHaveURL(new RegExp(`/app/habitos/${id}(\\?mes=${current})?$`));
    await expect(h2(page, current)).toBeVisible();
    await expect(link(page, "Mes siguiente")).toHaveCount(0);

    await openHistory(page, id, name, "2000-01");
    await expect(h2(page, "2000-01")).toHaveText("Enero de 2000");
    await expect(link(page, "Mes anterior"), "enero de 2000 es el primer mes").toHaveCount(0);
    await link(page, "Mes siguiente").click();
    await expect(page).toHaveURL(new RegExp(`/app/habitos/${id}\\?mes=2000-02$`));
    await expect(h2(page, "2000-02")).toHaveText("Febrero de 2000");
    await expect(link(page, "Mes anterior")).toBeVisible();
  });

  test("calendario de lunes a domingo: cabeceras L M X J V S D y, en un mes pasado, cada día es un <button> con su número visible, el nombre «<d> de <mes>», aria-pressed según la BD y en la columna de su día de la semana", async ({ page, api }) => {
    const today = dayAt(MADRID, new Date());
    const previous = shiftMonth(today.slice(0, 7), -1);
    const marks = [iso(previous, 1), iso(previous, 2), iso(previous, 15)];
    const { name, id } = await seedHabit(api, marks);
    await openHistory(page, id, name, previous);
    await expect(h2(page, previous)).toBeVisible();
    const last = daysIn(previous);
    await expect(monthButtons(page, previous)).toHaveCount(last);

    const headers = await page.evaluate((letters) => {
      const own = (el: Element) =>
        [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
      const found = [...document.querySelectorAll("body *")]
        .filter((el) => letters.includes(own(el)))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { text: own(el), cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, w: r.width, bottom: r.bottom };
        })
        .filter((h) => h.w > 1);
      const rows: (typeof found)[] = [];
      for (const h of found) {
        const row = rows.find((r) => Math.abs(r[0].cy - h.cy) <= 3);
        if (row) row.push(h);
        else rows.push([h]);
      }
      return (rows.find((r) => r.length === 7) ?? []).sort((a, b) => a.cx - b.cx);
    }, WEEK);
    expect(headers.map((h) => h.text), "una fila de cabeceras L M X J V S D, de izquierda a derecha").toEqual(WEEK);

    let previousTop = -Infinity;
    for (let d = 1; d <= last; d++) {
      const day = iso(previous, d);
      const target = dayIn(page, previous, d, today);
      await expect(target, day).toHaveAttribute("aria-pressed", String(marks.includes(day)));
      expect((await visibleTexts(target)).map((t) => t.text).join(""), `${day}: texto visible`).toBe(String(d));
      const box = (await target.boundingBox())!;
      const cx = box.x + box.width / 2;
      const nearest = headers.reduce((a, b) => (Math.abs(b.cx - cx) < Math.abs(a.cx - cx) ? b : a));
      expect(nearest.text, `${day}: bajo la cabecera de su día de la semana`).toBe(WEEK[weekday(day)]);
      expect(box.y, `${day}: debajo de las cabeceras`).toBeGreaterThan(headers[0].bottom - 1);
      if (d > 1) {
        if (weekday(day) === 0) expect(box.y, `${day}: el lunes empieza otra fila`).toBeGreaterThan(previousTop + 1);
        else expect(Math.abs(box.y - previousTop), `${day}: en la misma fila que el día anterior`).toBeLessThan(2);
      }
      previousTop = box.y;
    }
  });

  test("el mes de hoy: un botón por día hasta hoy (el de hoy, «<d> de <mes>, hoy»); los días futuros no son botones", async ({ page, api }) => {
    const { name, id, today, current } = await seedHabit(api);
    await openHistory(page, id, name);
    const todayD = Number(today.slice(8));
    await expect(monthButtons(page, current)).toHaveCount(todayD);
    for (let d = 1; d <= todayD; d++) {
      await expect(dayIn(page, current, d, today), iso(current, d)).toHaveAttribute("aria-pressed", "false");
    }
    await expect(page.getByRole("button", { name: `${todayD} de ${monthName(current)}, hoy`, exact: true })).toBeVisible();
    for (let d = todayD + 1; d <= daysIn(current); d++) {
      await expect(page.getByRole("button", { name: new RegExp(`^${d} de ${monthName(current)}`) }), `${iso(current, d)} es futuro`).toHaveCount(0);
    }
  });

  for (const width of [1280, 375]) {
    test(`a ${width} px: los días marcados con el color del hábito y los consecutivos de la misma semana unidos como en la cadena de la tarjeta ([data-link], esquinas interiores a 0)`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      const today = dayAt(MADRID, new Date());
      const previous = shiftMonth(today.slice(0, 7), -1);
      const monday = aMonday(previous);
      // Lunes y martes unidos; el jueves suelto; el 22, 23 y 24 (cada uno, unido a su vecino si caen en la misma semana).
      const marks = [monday, monday + 1, monday + 3, 22, 23, 24].map((d) => iso(previous, d));
      const { name, id } = await seedHabit(api, marks, "green");
      await openHistory(page, id, name, previous);
      const last = daysIn(previous);
      await expect
        .poll(() => calendarProblems(page, previous, last, today, marks), { message: "la cadena del calendario (vacío = bien)" })
        .toEqual([]);
      const { days } = await readCalendar(page, previous, last, today);
      const lone = days.find((d) => d.label === iso(previous, monday + 3))!;
      for (const day of days) {
        if (marks.includes(day.label)) {
          expect(inHue(day.fill, "green"), `${day.label}: relleno ${day.fill} fuera del verde`).toBe(true);
          expect(day.fill.every((v, k) => Math.abs(v - lone.fill[k]) <= 3), `${day.label}: mismo relleno que un día marcado`).toBe(true);
        } else {
          expect(day.fill.some((v, k) => Math.abs(v - lone.fill[k]) > 30), `${day.label}: sin marcar, distinto de un marcado`).toBe(true);
        }
      }
    });
  }
});

// ---------------------------------------------------------------- Marcar desde el historial

test.describe("marcar desde el historial", () => {
  test("al instante (optimista): aria-pressed y la cadena cambian antes de que responda el servidor; la BD, las estadísticas y lo que se ve al recargar coinciden; desmarcar borra", async ({ page, api }) => {
    const today = dayAt(MADRID, new Date());
    const previous = shiftMonth(today.slice(0, 7), -1);
    const monday = aMonday(previous);
    const first = iso(previous, monday);
    const second = iso(previous, monday + 1);
    const { name, id } = await seedHabit(api, [first]);
    await openHistory(page, id, name, previous);
    const target = dayIn(page, previous, monday + 1, today);
    const last = daysIn(previous);
    const sent = await slowSubmits(page);

    await target.click();
    // El envío tarda 1,5 s: si cambia antes, es la UI optimista.
    await expect(target).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
    await expect
      .poll(() => calendarProblems(page, previous, last, today, [first, second]), { timeout: 1000, message: "la cadena se une al instante" })
      .toEqual([]);
    await expect.poll(() => marked(api, id)).toEqual([first, second]);
    await expectPageStats(page, [first, second], today);
    await page.reload();
    await expect(target).toHaveAttribute("aria-pressed", "true");

    await target.click();
    await expect(target).toHaveAttribute("aria-pressed", "false", { timeout: 1000 });
    await expect.poll(() => marked(api, id)).toEqual([first]);
    await expectPageStats(page, [first], today);
    await page.reload();
    await expect(target).toHaveAttribute("aria-pressed", "false");
    await expect(dayIn(page, previous, monday, today)).toHaveAttribute("aria-pressed", "true");
    expect(sent.length, "un envío por clic").toBe(2);
    await expect(alert(page, GENERIC)).toHaveCount(0);
  });

  test("lo marcado en el historial (hoy) se ve en la tarjeta de /app, y lo marcado en la tarjeta (Ayer) se ve en el historial, tras recargar", async ({ page, api }) => {
    const { name, id, today, current } = await seedHabit(api);
    await openHistory(page, id, name);
    await dayIn(page, current, Number(today.slice(8)), today).click();
    await expect.poll(() => marked(api, id)).toEqual([today]);

    await openApp(page);
    await shownToday(page, name, MADRID);
    await expect(dayButton(page, "Hoy", name)).toHaveAttribute("aria-pressed", "true");
    await dayButton(page, "Ayer", name).click();
    const yesterday = addDays(today, -1);
    await expect.poll(() => marked(api, id)).toEqual([yesterday, today]);

    const month = yesterday.slice(0, 7);
    await openHistory(page, id, name, month);
    await expect(dayIn(page, month, Number(yesterday.slice(8)), today)).toHaveAttribute("aria-pressed", "true");
    await expectPageStats(page, [yesterday, today], today);
  });

  test("hasta el 2000-01-01: en ?mes=2000-01, marcar el «1 de enero» guarda 2000-01-01 sin error de rango", async ({ page, api }) => {
    const { name, id, today } = await seedHabit(api);
    await openHistory(page, id, name, "2000-01");
    const first = dayIn(page, "2000-01", 1, today);
    await first.click();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => marked(api, id)).toEqual(["2000-01-01"]);
    await expect(alert(page, RANGE)).toHaveCount(0);
    await expect(alert(page, GENERIC)).toHaveCount(0);
  });

  test("D-10: con 500, marcar y desmarcar vuelven al estado anterior, las estadísticas no cambian y sale «No se pudo completar. Inténtalo de nuevo.» en role=alert; la BD no cambia", async ({ page, api }) => {
    const today = dayAt(MADRID, new Date());
    const previous = shiftMonth(today.slice(0, 7), -1);
    const { name, id } = await seedHabit(api, [iso(previous, 10)]);
    await openHistory(page, id, name, previous);
    await failServerActions(page);

    const on = dayIn(page, previous, 10, today);
    const off = dayIn(page, previous, 11, today);
    await off.click();
    await expect(alert(page, GENERIC)).toBeVisible();
    await expect(off).toHaveAttribute("aria-pressed", "false");
    await on.click();
    await expect(alert(page, GENERIC)).toBeVisible();
    await expect(on).toHaveAttribute("aria-pressed", "true");
    await expectPageStats(page, [iso(previous, 10)], today);
    expect(await marked(api, id)).toEqual([iso(previous, 10)]);
  });

  test("D-10: tras un doble clic y un triple clic rápidos, la UI coincide con la BD (antes y después de recargar) y no hay duplicados", async ({ page, api }) => {
    const { name, id, today, current } = await seedHabit(api);
    const settled = trackActions(page);
    await openHistory(page, id, name);
    const target = dayIn(page, current, Number(today.slice(8)), today);
    for (const clickCount of [2, 3]) {
      await target.click({ clickCount });
      await settled();
      const inDb = await marked(api, id);
      expect(inDb.length, `${clickCount} clics: como mucho una fila`).toBeLessThanOrEqual(1);
      await expect(target, `${clickCount} clics: la UI no coincide con la BD`).toHaveAttribute("aria-pressed", String(inDb.includes(today)));
      await page.reload();
      await expect(target, `${clickCount} clics, al recargar`).toHaveAttribute("aria-pressed", String(inDb.includes(today)));
    }
  });

  test("D-05: cuerpo manipulado (día futuro, 1999-12-31 o un cuerpo que no es el esperado) → 200 con un error en español, la UI vuelve atrás y la BD no cambia", async ({ page, api }) => {
    const today = dayAt(MADRID, new Date());
    const previous = shiftMonth(today.slice(0, 7), -1);
    const { name, id } = await seedHabit(api);
    await openHistory(page, id, name, previous);
    const target = dayIn(page, previous, 15, today);
    const day = iso(previous, 15);
    const rewrites: [string, (body: string) => string, string?][] = [
      ["futuro", (body) => body.split(day).join(addDays(today, 1))],
      ["1999-12-31", (body) => body.split(day).join("1999-12-31")],
      ...NOT_FORM_DATA.map((junk) => [junk, () => junk, "text/plain;charset=UTF-8"] as [string, () => string, string]),
    ];
    for (const [what, rewrite, contentType] of rewrites) {
      const sent = await sendRewrittenAction(page, () => target.click(), rewrite, contentType);
      if (!contentType) expect(sent.original, "el cuerpo de la acción lleva el día como 'YYYY-MM-DD'").toContain(day);
      expect(sent.status, `${what}: estado HTTP`).toBe(200);
      expect([GENERIC, RANGE].some((m) => sent.body.includes(asciiPart(m))), `${what}: respuesta ${sent.body.slice(0, 200)}`).toBe(true);
      await expect(target, `${what}: la UI vuelve atrás`).toHaveAttribute("aria-pressed", "false");
      await expect(alert(page, RANGE).or(alert(page, GENERIC)).first(), `${what}: error en español anunciado`).toBeVisible();
    }
    expect(await marked(api, id)).toEqual([]);
  });
});

// ---------------------------------------------------------------- 404, sesión y caché

test.describe("404, sesión y caché", () => {
  test("un id que no es un uuid, que no existe o que es de otro usuario → 404 con «No encontramos ese hábito.» y «Tus hábitos» → /app; la misma respuesta en los tres casos", async ({ page }) => {
    const { other, id: othersId, name: othersName } = await otherUsersHabit();
    try {
      const seen: { status: number; title: string; text: string }[] = [];
      for (const id of ["no-es-un-uuid", crypto.randomUUID(), othersId]) {
        const response = await page.goto(historyUrl(id));
        expect(response?.status(), `${id}: estado HTTP`).toBe(404);
        await expect(page.getByText(NOT_FOUND, { exact: true }), id).toBeVisible();
        await expect(link(page, "Tus hábitos"), id).toHaveAttribute("href", "/app");
        expect(await response!.text(), `${id}: no filtra el nombre del hábito`).not.toContain(othersName);
        seen.push({ status: response!.status(), title: await page.title(), text: await page.locator("body").innerText() });
      }
      expect(seen[1], "uuid que no existe = id que no es un uuid").toEqual(seen[0]);
      expect(seen[2], "hábito de otro usuario = id que no es un uuid").toEqual(seen[0]);
      await link(page, "Tus hábitos").click();
      await expect(page).toHaveURL(/\/app\/?$/);
    } finally {
      await cleanUp(other);
    }
  });

  test("sin sesión, /app/habitos/<id> redirige a /login", async ({ browser, api, baseURL }) => {
    const { id } = await seedHabit(api);
    const context = await browser.newContext({ baseURL, storageState: NO_SESSION });
    try {
      const page = await context.newPage();
      for (const target of [historyUrl(id), historyUrl(id, "2000-01"), historyUrl(crypto.randomUUID())]) {
        await page.goto(target);
        await expect(page, target).toHaveURL(LOGIN_URL);
      }
    } finally {
      await context.close();
    }
  });

  test("/app/habitos/<id> sale con Cache-Control private y no-store: con sesión (200 y 404) y sin ella (307), en HTML, carga RSC y prefetch", async ({ api, session, baseURL }) => {
    const { id } = await seedHabit(api);
    const withSession = await playwrightRequest.newContext({ baseURL, storageState: session.storageState });
    const anonymousContext = await playwrightRequest.newContext({ baseURL, storageState: NO_SESSION });
    try {
      const pages: { path: string; note: string; headers?: Record<string, string>; status: number }[] = [
        { path: historyUrl(id), note: "HTML", status: 200 },
        { path: `${historyUrl(id)}?_rsc`, note: "carga RSC", headers: { RSC: "1" }, status: 200 },
        { path: historyUrl(id), note: "prefetch", headers: { "Next-Router-Prefetch": "1" }, status: 200 },
        { path: historyUrl(crypto.randomUUID()), note: "no existe", status: 404 },
      ];
      for (const { path, note, headers, status } of pages) {
        for (const [who, context, expected] of [
          ["con sesión", withSession, status],
          ["sin sesión", anonymousContext, 307],
        ] as const) {
          const response = await context.get(path, { headers, maxRedirects: 0 });
          const label = `${path} (${note}, ${who})`;
          expect(response.status(), label).toBe(expected);
          const cacheControl = response.headers()["cache-control"] ?? "";
          expect(cacheControl, label).toContain("private");
          expect(cacheControl, label).toContain("no-store");
        }
      }
    } finally {
      await withSession.dispose();
      await anonymousContext.dispose();
    }
  });
});

// La landing es estática: la misma con sesión y sin ella (landing.spec).
test("la landing ya no dice «puedes corregir los últimos 7 días»", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).not.toContainText(/puedes corregir los últimos 7 días/i);
  expect((await response!.text()).toLowerCase()).not.toContain("corregir los últimos 7 días");
});

// ---------------------------------------------------------------- Accesibilidad y móvil

test.describe("accesibilidad y móvil", () => {
  test("D-11: axe sin serious ni critical en el mes de hoy (con días marcados), en un mes pasado, en enero de 2000 y en el 404", async ({ page, api }) => {
    const today = dayAt(MADRID, new Date());
    const previous = shiftMonth(today.slice(0, 7), -1);
    const { name, id } = await seedHabit(api, [today, iso(previous, 3), iso(previous, 4), iso(previous, 20)], "red");
    for (const mes of [undefined, previous, "2000-01"]) {
      await openHistory(page, id, name, mes);
      await expectNoSeriousA11yViolations(page);
    }
    await page.goto(historyUrl(crypto.randomUUID()));
    await expect(page.getByText(NOT_FOUND, { exact: true })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("D-11: solo con teclado: «Mes anterior» con Enter, marcar el día 1 con Espacio y desmarcarlo con Enter (foco visible y sin perderlo) y «Volver a tus hábitos» con Enter", async ({ page, api }) => {
    const { name, id, today, previous } = await seedHabit(api);
    await openHistory(page, id, name);
    await tabTo(page, link(page, "Mes anterior"));
    await page.keyboard.press("Enter");
    await expect(h2(page, previous)).toBeVisible();

    const first = dayIn(page, previous, 1, today);
    await tabTo(page, first);
    await page.keyboard.press("Space");
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => marked(api, id)).toEqual([iso(previous, 1)]);
    await expect(first, "el foco sigue en el botón tras marcar").toBeFocused();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => marked(api, id)).toEqual([]);
    await expect(first, "el foco sigue en el botón tras desmarcar").toBeFocused();

    await openHistory(page, id, name);
    await tabTo(page, link(page, "Volver a tus hábitos"));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test("D-12: a 375×812, con un nombre de 60 caracteres, sin scroll horizontal; cada día, «Volver a tus hábitos», «Mes anterior», «Mes siguiente» y el «Historial» de la tarjeta miden ≥ 44×44", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const name = tooLong(prefix()).slice(0, 60);
    const [id] = await seed(api, { name });
    const today = dayAt(MADRID, new Date());
    const current = today.slice(0, 7);
    const previous = shiftMonth(current, -1);
    const expectBig = async (target: ReturnType<typeof link>, what: string) => {
      const box = await target.boundingBox();
      expect(box, `«${what}» visible`).not.toBeNull();
      expect(box!.width, `ancho de «${what}»`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `alto de «${what}»`).toBeGreaterThanOrEqual(44);
    };

    for (const [month, last] of [
      [current, Number(today.slice(8))],
      [previous, daysIn(previous)],
    ] as const) {
      await openHistory(page, id, name, month);
      await expectFitsMobile(page, Array.from({ length: last }, (_, i) => dayName(month, i + 1, today)));
      await expectBig(link(page, "Volver a tus hábitos"), "Volver a tus hábitos");
      await expectBig(link(page, "Mes anterior"), "Mes anterior");
      if (month === previous) await expectBig(link(page, "Mes siguiente"), "Mes siguiente");
    }

    await page.goto(historyUrl(crypto.randomUUID()));
    await expectFitsMobile(page, []);
    await expectBig(link(page, "Tus hábitos"), "Tus hábitos");

    await openApp(page);
    await expectFitsMobile(page, []);
    await expectBig(item(page, name).getByRole("link", { name: `Ver el historial de ${name}`, exact: true }), "Historial");
  });
});
