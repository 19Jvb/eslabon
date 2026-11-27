import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Locator, type Page } from "@playwright/test";
import {
  GENERIC,
  MADRID,
  announced,
  apiClient,
  asciiPart,
  button,
  cleanUp,
  env,
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
} from "./helpers";

// T18: la sección «Telegram» de /app, con el usuario de E2E (la demo no se toca).
// La vinculación del bot se simula llamando como anon a la RPC telegram_link(secreto, código, chat) con un chat
// ficticio aleatorio. DEPENDENCIA DECLARADA: TELEGRAM_WEBHOOK_SECRET y TELEGRAM_BOT_USERNAME tienen que estar en el
// entorno (.env.local en local). Si faltan, los tests que los usan FALLAN con «Falta la variable de entorno …»
// (helpers.env); nunca se saltan ni pasan en falso. El secreto no se imprime nunca.
// Requisito: la migración de T17 aplicada y el secreto insertado en private.telegram_secret del proyecto probado.
// Fuera de alcance aquí: «Telegram no está disponible ahora mismo.» (exige arrancar el servidor sin
// TELEGRAM_BOT_USERNAME; se comprueba aparte en la revisión).

const TITLE = "Telegram";
const INTRO = "Marca tus hábitos de hoy desde Telegram.";
const LINK = "Vincular con Telegram";
const CHECK = "Comprobar vinculación";
const UNLINK = "Desvincular";
const OPEN = "Abrir Telegram";
const NOT_YET = "Todavía no está vinculado. Envía el código al bot.";
/** Crockford base32: sin I, L, O ni U. */
const CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const RAW = /PGRST|42501|violates|permission denied|telegram_links|create_telegram_link_code|ZodError|invalid_type/i;
/** Cuerpos que nunca son los de una acción bien formada (ni sin argumentos, «[]», ni un FormData). */
const JUNK = ['["x"]', "[null]", "[42]", '[{"user_id":"00000000-0000-0000-0000-000000000000","p_tz":"Etc/GMT+12"}]'];

test.use({ timezoneId: MADRID });

const title = (page: Page) => page.getByRole("heading", { level: 2, name: TITLE, exact: true });
const openLink = (page: Page) => page.getByRole("link", { name: OPEN, exact: true });
const codeField = (page: Page) => page.getByLabel("Código", { exact: true });
const linkedText = (page: Page) => page.getByText(/^Vinculado con Telegram desde el /);

/** El código que se ve: el valor si es un input, o el texto del elemento etiquetado «Código». */
async function shownCode(page: Page) {
  await expect(codeField(page)).toHaveCount(1);
  const code = await codeField(page).evaluate((el) =>
    (el instanceof HTMLInputElement ? el.value : (el.textContent ?? "")).trim(),
  );
  expect(code, "el código: 8 caracteres de Crockford base32").toMatch(CODE);
  return code;
}

async function generate(page: Page) {
  await button(page, LINK).click();
  return shownCode(page);
}

/** Chat ficticio: grande, aleatorio y positivo (un chat privado), dentro de los enteros seguros de JS. */
const fakeChat = () => 8_000_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000_000_000);

/** Lo que haría el webhook: telegram_link como anon con el secreto del bot. Devuelve 'linked' o 'invalid_code'. */
async function linkAsBot(code: string, chat: number) {
  const { data, error } = await apiClient().rpc("telegram_link", {
    p_secret: env("TELEGRAM_WEBHOOK_SECRET"),
    p_code: code,
    p_chat_id: chat,
  });
  if (error) throw new Error(`telegram_link falló: ${error.code} ${error.message}`);
  return data as string;
}

async function statusAsBot(chat: number) {
  const { data, error } = await apiClient().rpc("telegram_status", {
    p_secret: env("TELEGRAM_WEBHOOK_SECRET"),
    p_chat_id: chat,
  });
  if (error) throw new Error(`telegram_status falló: ${error.code} ${error.message}`);
  return data as string;
}

/** Vincula al usuario de E2E por el camino real (código de la UI + RPC del bot) y abre /app vinculado. */
async function linkThroughUi(page: Page) {
  await openApp(page);
  const chat = fakeChat();
  expect(await linkAsBot(await generate(page), chat)).toBe("linked");
  await page.reload();
  await expect(button(page, UNLINK)).toBeVisible();
  return chat;
}

/** «27 de noviembre de 2026» de ahora o de hace 5 minutos (por si la página se pintó justo antes de la medianoche). */
const todayLong = () =>
  [0, 5 * 60_000].map((ago) =>
    new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: MADRID }).format(new Date(Date.now() - ago)),
  );

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function expectUnlinkedUi(page: Page) {
  await expect(title(page)).toBeVisible();
  await expect(page.getByText(INTRO, { exact: true })).toBeVisible();
  await expect(button(page, LINK)).toBeVisible();
  await expect(button(page, UNLINK)).toHaveCount(0);
  await expect(linkedText(page)).toHaveCount(0);
}

async function expectLinkedUi(page: Page) {
  const dates = todayLong().map(escapeRe).join("|");
  await expect(page.getByText(new RegExp(`^Vinculado con Telegram desde el (${dates})\\.?$`))).toBeVisible();
  await expect(button(page, UNLINK)).toBeVisible();
  await expect(button(page, LINK)).toHaveCount(0);
  await expect(codeField(page)).toHaveCount(0);
  await expect(openLink(page)).toHaveCount(0);
}

/** Filas de telegram_links que ve el usuario (la RLS limita a la suya), con las columnas que tiene concedidas. */
async function ownLinks(api: SupabaseClient) {
  const { data, error } = await api.from("telegram_links").select("user_id, linked_at");
  if (error) throw new Error(`No se pudo leer telegram_links: ${error.message}`);
  return data;
}

async function unlinkAll(api: SupabaseClient) {
  const { error } = await api.from("telegram_links").delete().not("user_id", "is", null);
  if (error) throw new Error(`No se pudo desvincular al usuario de E2E: ${error.message}`);
}

const expectTouchTarget = async (target: Locator, name: string) => {
  const box = await target.boundingBox();
  expect(box, `«${name}» visible`).not.toBeNull();
  expect(box!.width, `ancho de «${name}»`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `alto de «${name}»`).toBeGreaterThanOrEqual(44);
};

test.beforeEach(async ({ api }) => {
  await unlinkAll(api);
});

test.afterEach(async ({ api }) => {
  await unlinkAll(api);
  await cleanUp(api);
});

test.describe("sin vincular", () => {
  test("h2 «Telegram» debajo de la lista de hábitos y antes de «Nuevo hábito», con el texto y «Vincular con Telegram»", async ({ page, api }) => {
    const name = `${prefix()}-tg`;
    await seed(api, { name });
    await openApp(page);
    await expectUnlinkedUi(page);
    await expect(openLink(page)).toHaveCount(0);
    await expect(codeField(page)).toHaveCount(0);
    const order = await title(page).evaluate(
      (h2, [li, form]) => ({
        afterList: (li!.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        beforeForm: (h2.compareDocumentPosition(form!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      }),
      [await item(page, name).elementHandle(), await page.getByRole("heading", { name: "Nuevo hábito" }).elementHandle()],
    );
    expect(order, "la sección va entre la lista y «Nuevo hábito»").toEqual({ afterList: true, beforeForm: true });
  });

  test("«Vincular con Telegram» → «Abrir Telegram» (t.me/<bot>?start=<código>, _blank, noopener noreferrer), «Código», la caducidad y «Comprobar vinculación»", async ({ page }) => {
    await openApp(page);
    const code = await generate(page);
    const link = openLink(page);
    await expect(link).toHaveAttribute("href", `https://t.me/${env("TELEGRAM_BOT_USERNAME")}?start=${code}`);
    await expect(link).toHaveAttribute("target", "_blank");
    const rel = ((await link.getAttribute("rel")) ?? "").split(/\s+/);
    expect(rel, "rel").toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    await expect(codeField(page)).toBeVisible();
    await expect(
      page.getByText(`Caduca en 10 minutos. También puedes enviar /vincular ${code} al bot.`, { exact: true }),
    ).toBeVisible();
    await expect(button(page, CHECK)).toBeVisible();
  });

  test("volver a pulsar → otro código (también en el enlace); el anterior da invalid_code por RPC y el nuevo vincula", async ({ page, api }) => {
    await openApp(page);
    const first = await generate(page);
    await button(page, LINK).click();
    await expect.poll(() => shownCode(page), { message: "el código cambia" }).not.toBe(first);
    const second = await shownCode(page);
    await expect(openLink(page)).toHaveAttribute("href", new RegExp(`\\?start=${second}$`));
    const chat = fakeChat();
    expect(await linkAsBot(first, chat), "el código anterior ya no vale").toBe("invalid_code");
    expect(await ownLinks(api)).toHaveLength(0);
    expect(await linkAsBot(second, chat), "el código nuevo vincula").toBe("linked");
    expect(await ownLinks(api)).toHaveLength(1);
  });

  // Criterio añadido por el Orquestador en T18-r1.
  test("«Comprobar vinculación» sin haber vinculado → «Todavía no está vinculado. Envía el código al bot.» anunciado y el mismo código en pantalla", async ({ page, api }) => {
    await openApp(page);
    const code = await generate(page);
    await expect(page.getByText(NOT_YET, { exact: true }), "antes de comprobar, no se ve").toHaveCount(0);
    await button(page, CHECK).click();
    await expect(announced(page, NOT_YET), "en una región role=alert o aria-live").toBeVisible();
    await expect(page.getByText(NOT_YET, { exact: true }), "el texto exacto").toBeVisible();
    await expect(button(page, CHECK)).toBeEnabled();
    expect(await shownCode(page), "el código sigue siendo el mismo").toBe(code);
    await expect(button(page, UNLINK)).toHaveCount(0);
    expect(await ownLinks(api)).toHaveLength(0);
  });
});

test.describe("vinculado", () => {
  test("vinculación por RPC → «Comprobar vinculación» → «Vinculado con Telegram desde el <hoy largo es-ES>» y «Desvincular»; al recargar, igual", async ({ page, api }) => {
    await openApp(page);
    const chat = fakeChat();
    expect(await linkAsBot(await generate(page), chat)).toBe("linked");
    await button(page, CHECK).click();
    await expectLinkedUi(page);
    expect(await statusAsBot(chat)).toBe("linked");
    expect(await ownLinks(api)).toHaveLength(1);
    await page.reload();
    await expectLinkedUi(page);
  });

  test("«Desvincular» → vuelve a sin vincular; telegram_status da not_linked, la API no ve fila y al recargar sigue igual", async ({ page, api }) => {
    const chat = await linkThroughUi(page);
    await button(page, UNLINK).click();
    await expectUnlinkedUi(page);
    expect(await statusAsBot(chat)).toBe("not_linked");
    expect(await ownLinks(api)).toHaveLength(0);
    await page.reload();
    await expectUnlinkedUi(page);
  });
});

test.describe("D-05: cuerpo manipulado → el genérico, sin error crudo", () => {
  test("«Vincular con Telegram» con un cuerpo que no es el esperado → 200, el genérico anunciado y ningún código", async ({ page }) => {
    for (const junk of JUNK) {
      await openApp(page);
      const sent = await sendRewrittenAction(page, () => button(page, LINK).click(), () => junk, "text/plain;charset=UTF-8");
      expect(sent.status, `${junk}: estado HTTP`).toBe(200);
      expect(sent.body, `${junk}: sin error crudo`).not.toMatch(RAW);
      expect(sent.body, `${junk}: el genérico en la respuesta`).toContain(asciiPart(GENERIC));
      await expect(announced(page, GENERIC), `${junk}: el genérico en la UI`).toBeVisible();
      await expect(openLink(page), `${junk}: sin enlace`).toHaveCount(0);
      await expect(codeField(page), `${junk}: sin código`).toHaveCount(0);
    }
  });

  test("«Desvincular» con un cuerpo que no es el esperado → 200, el genérico anunciado y sigue vinculado", async ({ page, api }) => {
    await linkThroughUi(page);
    for (const junk of JUNK) {
      await openApp(page);
      const sent = await sendRewrittenAction(page, () => button(page, UNLINK).click(), () => junk, "text/plain;charset=UTF-8");
      expect(sent.status, `${junk}: estado HTTP`).toBe(200);
      expect(sent.body, `${junk}: sin error crudo`).not.toMatch(RAW);
      expect(sent.body, `${junk}: el genérico en la respuesta`).toContain(asciiPart(GENERIC));
      await expect(announced(page, GENERIC), `${junk}: el genérico en la UI`).toBeVisible();
      expect(await ownLinks(api), `${junk}: el vínculo sigue`).toHaveLength(1);
    }
  });
});

// T18-r2: «Comprobar vinculación» pasa a ser una Server Action (checkTelegramLink), así que también se le aplica D-05.
test.describe("D-05: «Comprobar vinculación» con un cuerpo manipulado", () => {
  test("→ 200, el genérico anunciado, sin «Todavía no…»; ya vinculado por RPC, un cuerpo manipulado tampoco cambia la vista y uno bueno sí", async ({ page }) => {
    let code = "";
    for (const junk of JUNK) {
      await openApp(page);
      code = await generate(page);
      const sent = await sendRewrittenAction(page, () => button(page, CHECK).click(), () => junk, "text/plain;charset=UTF-8");
      expect(sent.status, `${junk}: estado HTTP`).toBe(200);
      expect(sent.body, `${junk}: sin error crudo`).not.toMatch(RAW);
      expect(sent.body, `${junk}: el genérico en la respuesta`).toContain(asciiPart(GENERIC));
      await expect(announced(page, GENERIC), `${junk}: el genérico en la UI`).toBeVisible();
      await expect(page.getByText(NOT_YET, { exact: true }), `${junk}: no dice «Todavía no…»`).toHaveCount(0);
      expect(await shownCode(page), `${junk}: el código sigue`).toBe(code);
    }
    expect(await linkAsBot(code, fakeChat())).toBe("linked");
    await sendRewrittenAction(page, () => button(page, CHECK).click(), () => JUNK[0], "text/plain;charset=UTF-8");
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(linkedText(page), "un cuerpo manipulado no llega a leer el vínculo").toHaveCount(0);
    await button(page, CHECK).click();
    await expectLinkedUi(page);
  });
});

test.describe("D-10: envío y errores", () => {
  test("«Comprobar vinculación» con 500 y sin red → el genérico anunciado, el botón activo, el mismo código y sin «Todavía no…»", async ({ page }) => {
    await openApp(page);
    const code = await generate(page);
    await failServerActions(page);
    await button(page, CHECK).click();
    await expect(announced(page, GENERIC), "500: el genérico").toBeVisible();
    await expect(page.getByText(NOT_YET, { exact: true }), "500: no dice «Todavía no…»").toHaveCount(0);
    await expect(button(page, CHECK)).toBeEnabled();
    expect(await shownCode(page)).toBe(code);

    await page.unrouteAll({ behavior: "wait" });
    await openApp(page);
    const second = await generate(page);
    await page.route("**/*", async (route) => {
      const r = route.request();
      if (r.method() === "POST" && (await r.headerValue("next-action")) !== null) return route.abort("internetdisconnected");
      return route.continue();
    });
    await button(page, CHECK).click();
    await expect(announced(page, GENERIC), "sin red: el genérico").toBeVisible();
    await expect(page.getByText(NOT_YET, { exact: true }), "sin red: no dice «Todavía no…»").toHaveCount(0);
    await expect(button(page, CHECK)).toBeEnabled();
    expect(await shownCode(page)).toBe(second);
  });

  test("«Vincular con Telegram» con 500 → el genérico anunciado, el botón activo y ningún código ni enlace", async ({ page }) => {
    await openApp(page);
    await failServerActions(page);
    await button(page, LINK).click();
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(button(page, LINK)).toBeEnabled();
    await expect(openLink(page)).toHaveCount(0);
    await expect(codeField(page)).toHaveCount(0);
    await expect(page.getByText(INTRO, { exact: true })).toBeVisible();
  });

  test("«Desvincular» con 500 → el genérico anunciado y sigue vinculado (texto, botón activo y la fila)", async ({ page, api }) => {
    await linkThroughUi(page);
    await failServerActions(page);
    await button(page, UNLINK).click();
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(button(page, UNLINK)).toBeEnabled();
    await expect(linkedText(page)).toBeVisible();
    expect(await ownLinks(api)).toHaveLength(1);
  });

  test("doble clic en «Vincular con Telegram» → un solo envío, deshabilitado mientras envía, y el código que se ve vincula", async ({ page, api }) => {
    await openApp(page);
    const sent = await slowSubmits(page);
    await button(page, LINK).dblclick();
    await expect(button(page, LINK), "deshabilitado mientras envía").toBeDisabled();
    const code = await shownCode(page);
    expect(sent, "un solo envío").toHaveLength(1);
    expect(await linkAsBot(code, fakeChat()), "el código que se ve es el vigente").toBe("linked");
    expect(await ownLinks(api)).toHaveLength(1);
  });

  test("doble clic en «Desvincular» → un solo envío, deshabilitado mientras envía, desvinculado y sin error", async ({ page, api }) => {
    await linkThroughUi(page);
    const sent = await slowSubmits(page);
    await button(page, UNLINK).dblclick();
    await expect(button(page, UNLINK), "deshabilitado mientras envía").toBeDisabled();
    await expectUnlinkedUi(page);
    expect(sent, "un solo envío").toHaveLength(1);
    expect(await ownLinks(api)).toHaveLength(0);
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  });
});

test.describe("D-11 y D-12", () => {
  test("D-11: axe sin serious ni critical sin vincular, con el código y vinculado", async ({ page }) => {
    await openApp(page);
    await test.step("sin vincular", () => expectNoSeriousA11yViolations(page));
    const chat = fakeChat();
    const code = await generate(page);
    await test.step("con el código", () => expectNoSeriousA11yViolations(page));
    expect(await linkAsBot(code, chat)).toBe("linked");
    await button(page, CHECK).click();
    await expectLinkedUi(page);
    await test.step("vinculado", () => expectNoSeriousA11yViolations(page));
  });

  test("D-11: solo con teclado: Tab + Enter en «Vincular», Tab hasta «Abrir Telegram» y «Comprobar vinculación» (foco visible), Space en «Desvincular»", async ({ page }) => {
    await openApp(page);
    await tabTo(page, button(page, LINK));
    await page.keyboard.press("Enter");
    const code = await shownCode(page);
    await tabTo(page, openLink(page));
    await tabTo(page, button(page, CHECK));
    expect(await linkAsBot(code, fakeChat())).toBe("linked");
    await page.keyboard.press("Enter");
    await expectLinkedUi(page);
    await tabTo(page, button(page, UNLINK));
    await page.keyboard.press("Space");
    await expectUnlinkedUi(page);
  });

  test("D-12: a 375×812, sin scroll horizontal y «Vincular», «Abrir Telegram», «Comprobar vinculación» y «Desvincular» ≥ 44×44", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openApp(page);
    await expectFitsMobile(page, [LINK]);
    const code = await generate(page);
    await expectFitsMobile(page, [LINK, CHECK]);
    await expectTouchTarget(openLink(page), OPEN);
    expect(await linkAsBot(code, fakeChat())).toBe("linked");
    await button(page, CHECK).click();
    await expectLinkedUi(page);
    await expectFitsMobile(page, [UNLINK]);
  });
});
