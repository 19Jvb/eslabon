import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { type SupabaseClient } from "@supabase/supabase-js";
import { MADRID, apiClient, cleanUp, env, marked, prefix, seed, test, wipeAll } from "./helpers";

// T19: POST /api/telegram/webhook, de punta a punta, con el usuario de E2E (la demo no se toca).
// Montaje: este archivo arranca un simulador de la API de Telegram en TELEGRAM_API_BASE (playwright.config.ts la fija a
// http://127.0.0.1:4545 en local y el webServer la hereda). El simulador registra cada llamada (método y cuerpo) y
// responde como Telegram. Los updates se mandan como Telegram: POST con X-Telegram-Bot-Api-Secret-Token.
// Los chats son ficticios, grandes y aleatorios. Ni el token ni el secreto se imprimen nunca: se comparan con booleanos.
// Fuera de alcance aquí (revisión por inspección): 503 sin TELEGRAM_WEBHOOK_SECRET (exige otro servidor), la
// comparación en tiempo constante, que no se use service_role y que handleUpdate tenga sus tests unitarios.

const HOOK = "/api/telegram/webhook";
const HEADER = "X-Telegram-Bot-Api-Secret-Token";

const LINKED = "¡Listo! Tu cuenta de Eslabón está vinculada. Si no has sido tú, envía /desvincular.";
const INVALID = "El código no es válido o ha caducado. Genera otro en la app.";
const HELLO = "Hola, soy el bot de Eslabón. Para empezar, vincula tu cuenta desde la app con «Vincular con Telegram».";
const NO_CODE = "Envía /vincular seguido del código que te da la app.";
const LINK_FIRST = "Primero vincula tu cuenta desde la app con «Vincular con Telegram».";
const NO_HABITS = "Aún no tienes hábitos. Créalos en la app.";
const UNLINKED = "Tu cuenta se ha desvinculado.";
const NOTHING_LINKED = "No había ninguna cuenta vinculada.";
const PRIVATE_ONLY = "Úsame en un chat privado.";
const COMMANDS = ["/hoy", "/vincular", "/desvincular", "/ayuda"];

// ---------- Simulador de la API de Telegram ----------

type Body = Record<string, unknown>;
type Call = { method: string; body: Body; result: unknown; tokenOk: boolean };
type Button = { text: string; callback_data: string };

const calls: Call[] = [];
/** Con true, el simulador responde 500 a todo (Telegram caído). */
let telegramDown = false;
let nextMessageId = 1000;
let server: Server;

/** JSON o x-www-form-urlencoded, que Telegram acepta los dos; reply_markup puede llegar como texto JSON. */
function parseBody(raw: string, type: string): Body {
  const body: Body = type.includes("json") ? (raw ? JSON.parse(raw) : {}) : Object.fromEntries(new URLSearchParams(raw));
  if (typeof body.reply_markup === "string") body.reply_markup = JSON.parse(body.reply_markup);
  return body;
}

function reply(method: string, body: Body) {
  const chat = { id: Number(body.chat_id), type: "private" };
  const date = Math.floor(Date.now() / 1000);
  if (method === "sendMessage") return { message_id: nextMessageId++, date, chat, text: body.text };
  if (method === "editMessageText") return { message_id: Number(body.message_id), date, chat, text: body.text };
  return true;
}

test.beforeAll(async () => {
  const { port, hostname } = new URL(env("TELEGRAM_API_BASE"));
  const tokenPath = `/bot${env("TELEGRAM_BOT_TOKEN")}/`;
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const path = req.url ?? "";
      const method = path.split("?")[0].split("/").pop() ?? "";
      let body: Body = {};
      try {
        body = parseBody(raw, req.headers["content-type"] ?? "");
      } catch {
        body = { unparsed: true };
      }
      const result = telegramDown ? undefined : reply(method, body);
      calls.push({ method, body, result, tokenOk: path.startsWith(tokenPath) });
      res.setHeader("content-type", "application/json");
      res.statusCode = telegramDown ? 500 : 200;
      res.end(JSON.stringify(telegramDown ? { ok: false, error_code: 500, description: "Internal Server Error" } : { ok: true, result }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(port), hostname, resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

// ---------- Updates y llamadas ----------

/** Chat ficticio: grande, aleatorio y positivo (un chat privado), dentro de los enteros seguros de JS. */
const fakeChat = () => 8_000_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000_000_000);
const updateId = () => Math.floor(Math.random() * 2_000_000_000);

function message(chat: number, text: string, type = "private") {
  const command = text.match(/^\/\S+/);
  return {
    update_id: updateId(),
    message: {
      message_id: Math.floor(Math.random() * 100_000),
      date: Math.floor(Date.now() / 1000),
      from: { id: type === "private" ? chat : 7_000_000_001, is_bot: false, first_name: "E2E", language_code: "es" },
      chat: type === "private" ? { id: chat, type, first_name: "E2E" } : { id: chat, type, title: "Grupo e2e" },
      text,
      ...(command ? { entities: [{ offset: 0, length: command[0].length, type: "bot_command" }] } : {}),
    },
  };
}

function callback(chat: number, data: string, messageId: number) {
  const id = randomUUID();
  return {
    id,
    update: {
      update_id: updateId(),
      callback_query: {
        id,
        from: { id: chat, is_bot: false, first_name: "E2E", language_code: "es" },
        message: {
          message_id: messageId,
          date: Math.floor(Date.now() / 1000),
          from: { id: 7_000_000_000, is_bot: true, first_name: "Eslabón" },
          chat: { id: chat, type: "private", first_name: "E2E" },
          text: "Tus hábitos de hoy",
        },
        chat_instance: String(updateId()),
        data,
      },
    },
  };
}

/** Ni el cuerpo ni las cabeceras de una respuesta de la route llevan el token o el secreto (sin imprimirlos). */
async function expectNoSecrets(res: APIResponse) {
  const all = (await res.text()) + JSON.stringify(res.headers());
  expect(all.includes(env("TELEGRAM_BOT_TOKEN")), "la respuesta no contiene el token").toBe(false);
  expect(all.includes(env("TELEGRAM_WEBHOOK_SECRET")), "la respuesta no contiene el secreto").toBe(false);
}

/** POST al webhook como Telegram. secret: null → sin cabecera. */
async function post(request: APIRequestContext, update: unknown, secret: string | null = env("TELEGRAM_WEBHOOK_SECRET")) {
  const res = await request.post(HOOK, {
    headers: secret === null ? {} : { [HEADER]: secret },
    data: update,
    maxRedirects: 0,
  });
  await expectNoSecrets(res);
  return res;
}

/** Manda un texto desde un chat privado: 200. */
async function say(request: APIRequestContext, chat: number, text: string) {
  const res = await post(request, message(chat, text));
  expect(res.status(), `«${text}» → 200`).toBe(200);
}

const sentTo = (chat: number, method = "sendMessage") =>
  calls.filter((c) => c.method === method && String(c.body.chat_id) === String(chat));

/** Espera a que el chat reciba n sendMessage y devuelve el último. */
async function lastMessage(chat: number, n = 1) {
  await expect.poll(() => sentTo(chat).length, { message: `sendMessage al chat (${n})` }).toBeGreaterThanOrEqual(n);
  return sentTo(chat)[n - 1].body;
}

/** Lo que dice el bot al chat tras un texto: el cuerpo del sendMessage nuevo. */
async function ask(request: APIRequestContext, chat: number, text: string) {
  const before = sentTo(chat).length;
  await say(request, chat, text);
  return lastMessage(chat, before + 1);
}

const buttons = (body: Body): Button[] => {
  const markup = body.reply_markup as { inline_keyboard?: Button[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat().map(({ text, callback_data }) => ({ text, callback_data }));
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 1000));

// ---------- RPC: como el usuario de E2E (crear el código) y como el bot (estado y «hoy») ----------

async function newCode(api: SupabaseClient) {
  const { data, error } = await api.rpc("create_telegram_link_code", { p_tz: MADRID });
  if (error) throw new Error(`create_telegram_link_code falló: ${error.code} ${error.message}`);
  return data as string;
}

async function status(chat: number) {
  const { data, error } = await apiClient().rpc("telegram_status", {
    p_secret: env("TELEGRAM_WEBHOOK_SECRET"),
    p_chat_id: chat,
  });
  if (error) throw new Error(`telegram_status falló: ${error.code} ${error.message}`);
  return data as string;
}

/** El «hoy» del vínculo según telegram_today (hace falta al menos un hábito). */
async function rpcToday(chat: number) {
  const { data, error } = await apiClient().rpc("telegram_today", {
    p_secret: env("TELEGRAM_WEBHOOK_SECRET"),
    p_chat_id: chat,
  });
  if (error) throw new Error(`telegram_today falló: ${error.code} ${error.message}`);
  return (data as { today: string }[])[0].today;
}

const longDate = (day: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/** Vincula al usuario de E2E con un chat nuevo a través del webhook. */
async function linkChat(request: APIRequestContext, api: SupabaseClient) {
  const chat = fakeChat();
  expect((await ask(request, chat, `/start ${await newCode(api)}`)).text).toBe(LINKED);
  return chat;
}

/** /hoy con dos hábitos: devuelve el chat, los hábitos, el mensaje del teclado y los «hoy» válidos. */
async function todayWithTwo(request: APIRequestContext, api: SupabaseClient, names?: [string, string]) {
  const p = prefix();
  const [a, b] = names ?? [`${p}-agua`, `${p}-leer`];
  const [idA, idB] = await seed(api, { name: a }, { name: b });
  const chat = await linkChat(request, api);
  const before = await rpcToday(chat);
  const body = await ask(request, chat, "/hoy");
  const after = await rpcToday(chat);
  return { chat, a, b, idA, idB, body, headers: [before, after].map((d) => `Tus hábitos de hoy (${longDate(d)}):`) };
}

async function unlinkAll(api: SupabaseClient) {
  const { error } = await api.from("telegram_links").delete().not("user_id", "is", null);
  if (error) throw new Error(`No se pudo desvincular al usuario de E2E: ${error.message}`);
}

test.beforeEach(async ({ api }) => {
  telegramDown = false;
  calls.length = 0;
  await unlinkAll(api);
});

test.afterEach(async ({ api }) => {
  telegramDown = false;
  await unlinkAll(api);
  await cleanUp(api);
  // Todas las llamadas a Telegram: a la URL con el token y en texto plano.
  expect(calls.filter((c) => !c.tokenOk).map((c) => c.method), "llamadas sin /bot<TOKEN>/ en la ruta").toEqual([]);
  expect(calls.filter((c) => "parse_mode" in c.body).map((c) => c.method), "llamadas con parse_mode").toEqual([]);
});

// ---------- Tests ----------

test.describe("secreto del webhook", () => {
  test("sin cabecera o con un secreto incorrecto → 401, sin redirección y el simulador no recibe nada; con el bueno → 200", async ({ request }) => {
    const secret = env("TELEGRAM_WEBHOOK_SECRET");
    const wrong = [null, "", "x", secret.slice(0, -1), `${secret}x`, `${secret.slice(0, -1)}${secret.endsWith("a") ? "b" : "a"}`];
    const chat = fakeChat();
    for (const [i, bad] of wrong.entries()) {
      const res = await post(request, message(chat, "/ayuda"), bad);
      expect(res.status(), `secreto incorrecto n.º ${i}: 401`).toBe(401);
    }
    await settle();
    expect(calls, "con 401 no se llama a Telegram").toHaveLength(0);
    await say(request, chat, "/ayuda");
    await lastMessage(chat);
  });

  test("con un secreto incorrecto no se procesa nada: /start <código válido> no vincula y el código sigue valiendo", async ({ request, api }) => {
    const code = await newCode(api);
    const chat = fakeChat();
    const res = await post(request, message(chat, `/start ${code}`), "secreto-incorrecto");
    expect(res.status()).toBe(401);
    await settle();
    expect(await status(chat), "401: el chat no queda vinculado").toBe("not_linked");
    expect(calls).toHaveLength(0);
    expect((await ask(request, chat, `/start ${code}`)).text, "el código no se consumió").toBe(LINKED);
  });

  test("con el secreto bueno, siempre 200: updates que no se entienden, otros tipos de update y Telegram caído", async ({ request }) => {
    const chat = fakeChat();
    const junk: unknown[] = [{}, [], { update_id: 1 }, { update_id: 2, edited_message: message(chat, "/hoy").message },
      { update_id: 3, message: { chat: { id: chat, type: "private" } } }, { update_id: 4, message: "x" },
      { update_id: 5, callback_query: { id: "x" } }, { update_id: 6, my_chat_member: { chat: { id: chat } } }];
    for (const update of junk) {
      const res = await post(request, update);
      expect(res.status(), `${JSON.stringify(update).slice(0, 60)} → 200`).toBe(200);
    }
    const res = await request.post(HOOK, {
      headers: { [HEADER]: env("TELEGRAM_WEBHOOK_SECRET"), "content-type": "application/json" },
      data: "esto no es json",
      maxRedirects: 0,
    });
    await expectNoSecrets(res);
    expect(res.status(), "cuerpo que no es JSON → 200").toBe(200);

    telegramDown = true;
    await say(request, chat, "/ayuda");
    await expect.poll(() => sentTo(chat).length, { message: "intentó enviar aunque Telegram falle" }).toBeGreaterThan(0);
  });
});

test.describe("vinculación", () => {
  test("/start <código> → «¡Listo!…» al chat y telegram_status da linked; reusar el código → «no es válido»", async ({ request, api }) => {
    const code = await newCode(api);
    const chat = fakeChat();
    expect(await status(chat)).toBe("not_linked");
    const body = await ask(request, chat, `/start ${code}`);
    expect(body.text).toBe(LINKED);
    expect(String(body.chat_id)).toBe(String(chat));
    expect(await status(chat)).toBe("linked");
    const { data } = await api.from("telegram_links").select("user_id, linked_at");
    expect(data, "el usuario de E2E ve su vínculo").toHaveLength(1);

    const other = fakeChat();
    expect((await ask(request, other, `/vincular ${code}`)).text, "un solo uso").toBe(INVALID);
    expect(await status(other)).toBe("not_linked");
  });

  test("/vincular <código en minúsculas y con espacios> → se normaliza y vincula", async ({ request, api }) => {
    const code = await newCode(api);
    const messy = `  ${code.slice(0, 3).toLowerCase()} ${code.slice(3, 6).toLowerCase()}  ${code.slice(6).toLowerCase()} `;
    const chat = fakeChat();
    expect((await ask(request, chat, `/vincular ${messy}`)).text).toBe(LINKED);
    expect(await status(chat)).toBe("linked");
  });

  test("un código inválido → «El código no es válido o ha caducado…» y sin vínculo, con /start y con /vincular", async ({ request }) => {
    const chat = fakeChat();
    expect((await ask(request, chat, "/start ZZZZZZZZ")).text).toBe(INVALID);
    expect((await ask(request, chat, "/vincular 00000000")).text).toBe(INVALID);
    expect(await status(chat)).toBe("not_linked");
  });

  test("/start sin código → el saludo; /vincular sin código → cómo usarlo", async ({ request }) => {
    const chat = fakeChat();
    expect((await ask(request, chat, "/start")).text).toBe(HELLO);
    expect((await ask(request, chat, "/vincular")).text).toBe(NO_CODE);
  });
});

test.describe("/hoy", () => {
  test("sin vínculo → «Primero vincula tu cuenta…»", async ({ request }) => {
    const body = await ask(request, fakeChat(), "/hoy");
    expect(body.text).toBe(LINK_FIRST);
    expect(buttons(body)).toEqual([]);
  });

  test("vinculado y sin hábitos → «Aún no tienes hábitos. Créalos en la app.»", async ({ request, api }) => {
    await wipeAll(api);
    const chat = await linkChat(request, api);
    const body = await ask(request, chat, "/hoy");
    expect(body.text).toBe(NO_HABITS);
    expect(buttons(body)).toEqual([]);
  });

  test("con 2 hábitos → «Tus hábitos de hoy (<fecha larga>):» y un botón «⬜ <nombre>» con c:<id>:1 por hábito (≤ 64 bytes)", async ({ request, api }) => {
    const { a, b, idA, idB, body, headers } = await todayWithTwo(request, api);
    expect(headers, "la cabecera con la fecha larga es-ES del today de la RPC").toContain(body.text);
    const keyboard = buttons(body);
    expect(keyboard).toHaveLength(2);
    expect(keyboard).toEqual(
      expect.arrayContaining([
        { text: `⬜ ${a}`, callback_data: `c:${idA}:1` },
        { text: `⬜ ${b}`, callback_data: `c:${idB}:1` },
      ]),
    );
    for (const { callback_data } of keyboard) expect(Buffer.byteLength(callback_data)).toBeLessThanOrEqual(64);
  });

  test("un hábito marcado hoy sale «✅ <nombre>» con c:<id>:0", async ({ request, api }) => {
    const p = prefix();
    const [id] = await seed(api, { name: `${p}-hecho` });
    const chat = await linkChat(request, api);
    await api.from("check_ins").insert({ habit_id: id, day: await rpcToday(chat) });
    const body = await ask(request, chat, "/hoy");
    expect(buttons(body)).toEqual([{ text: `✅ ${p}-hecho`, callback_data: `c:${id}:0` }]);
  });

  test("un nombre con caracteres de formato llega literal, sin parse_mode", async ({ request, api }) => {
    const p = prefix();
    const tricky = `${p}-<b>*_[x](y)`;
    const { idA, body } = await todayWithTwo(request, api, [tricky, `${p}-normal`]);
    expect(buttons(body)).toContainEqual({ text: `⬜ ${tricky}`, callback_data: `c:${idA}:1` });
    expect("parse_mode" in body, "sin parse_mode").toBe(false);
  });
});

test.describe("botones (callback_query)", () => {
  test("c:<id>:1 → «Marcado», el mensaje se edita con «✅ <nombre>» y hay check-in de hoy; c:<id>:0 → «Desmarcado» y 0", async ({ request, api }) => {
    const { chat, a, b, idA, idB, body, headers } = await todayWithTwo(request, api);
    const messageId = messageIdOf(body);
    const day = await rpcToday(chat);

    const mark = callback(chat, `c:${idA}:1`, messageId);
    expect((await post(request, mark.update)).status()).toBe(200);
    const answer = await answered(mark.id);
    expect(answer.text).toBe("Marcado");
    const edit = await edited(chat, 1);
    expect(Number(edit.message_id)).toBe(messageId);
    expect(headers).toContain(edit.text);
    expect(buttons(edit)).toEqual(
      expect.arrayContaining([
        { text: `✅ ${a}`, callback_data: `c:${idA}:0` },
        { text: `⬜ ${b}`, callback_data: `c:${idB}:1` },
      ]),
    );
    expect(await marked(api, idA), "check-in de hoy en la BD (como el usuario de E2E)").toEqual([day]);

    const unmark = callback(chat, `c:${idA}:0`, messageId);
    expect((await post(request, unmark.update)).status()).toBe(200);
    expect((await answered(unmark.id)).text).toBe("Desmarcado");
    const second = await edited(chat, 2);
    expect(buttons(second)).toEqual(expect.arrayContaining([{ text: `⬜ ${a}`, callback_data: `c:${idA}:1` }]));
    expect(await marked(api, idA)).toEqual([]);
  });

  test("pulsar dos veces el mismo «marcar» (reintento de Telegram) → un solo check-in", async ({ request, api }) => {
    const { chat, idA, body } = await todayWithTwo(request, api);
    for (let i = 0; i < 2; i++) {
      const mark = callback(chat, `c:${idA}:1`, messageIdOf(body));
      expect((await post(request, mark.update)).status()).toBe(200);
      await answered(mark.id);
    }
    expect(await marked(api, idA)).toHaveLength(1);
  });

  test("un callback_data mal formado → 200, sin check-in ni edición", async ({ request, api }) => {
    const { chat, idA } = await todayWithTwo(request, api);
    const bad = ["", "x", "c:", `c:${idA}`, `c:${idA}:2`, `c:${idA}:1:extra`, "c:no-es-un-uuid:1", `d:${idA}:1`];
    for (const data of bad) {
      const res = await post(request, callback(chat, data, 1).update);
      expect(res.status(), `«${data}» → 200`).toBe(200);
    }
    await settle();
    expect(await marked(api, idA)).toEqual([]);
    expect(sentTo(chat, "editMessageText"), "no edita el mensaje").toHaveLength(0);
  });

  test("not_linked o not_found → el callback lo dice (no «Marcado») y no hay check-in", async ({ request, api }) => {
    const { chat, idA } = await todayWithTwo(request, api);
    const stranger = callback(fakeChat(), `c:${idA}:1`, 1);
    expect((await post(request, stranger.update)).status()).toBe(200);
    const notLinked = await answered(stranger.id);
    expect(String(notLinked.text ?? "").trim(), "not_linked: dice algo").not.toBe("");
    expect(notLinked.text).not.toBe("Marcado");

    const missing = callback(chat, `c:${randomUUID()}:1`, 1);
    expect((await post(request, missing.update)).status()).toBe(200);
    const notFound = await answered(missing.id);
    expect(String(notFound.text ?? "").trim(), "not_found: dice algo").not.toBe("");
    expect(notFound.text).not.toBe("Marcado");
    expect(await marked(api, idA)).toEqual([]);
  });
});

test.describe("chats que no son privados", () => {
  for (const type of ["group", "supergroup"]) {
    test(`un chat «${type}» no procesa comandos: /start <código> no vincula y, si responde, es «${PRIVATE_ONLY}»`, async ({ request, api }) => {
      const code = await newCode(api);
      const group = -(1_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
      for (const text of [`/start ${code}`, "/hoy", "/ayuda"]) {
        const res = await post(request, message(group, text, type));
        expect(res.status(), `${type} «${text.split(" ")[0]}» → 200`).toBe(200);
      }
      await settle();
      expect(await status(group), "el grupo no queda vinculado").toBe("not_linked");
      const replies = calls.map((c) => c.body.text).filter((t) => t !== undefined);
      expect(replies.filter((t) => t !== PRIVATE_ONLY), "solo «Úsame en un chat privado.» o nada").toEqual([]);
      const chat = fakeChat();
      expect((await ask(request, chat, `/start ${code}`)).text, "el código sigue valiendo en privado").toBe(LINKED);
    });
  }
});

test.describe("/desvincular y /ayuda", () => {
  test("/desvincular vinculado → «Tu cuenta se ha desvinculado.» y not_linked; otra vez → «No había ninguna cuenta vinculada.»", async ({ request, api }) => {
    const chat = await linkChat(request, api);
    expect((await ask(request, chat, "/desvincular")).text).toBe(UNLINKED);
    expect(await status(chat)).toBe("not_linked");
    const { data } = await api.from("telegram_links").select("user_id, linked_at");
    expect(data).toHaveLength(0);
    expect([NOTHING_LINKED, UNLINKED]).toContain((await ask(request, chat, "/desvincular")).text);
  });

  test("/ayuda → la lista de comandos; cualquier otro texto → la misma lista", async ({ request }) => {
    const chat = fakeChat();
    const help = String((await ask(request, chat, "/ayuda")).text);
    for (const command of COMMANDS) expect(help, `la ayuda nombra ${command}`).toContain(command);
    expect((await ask(request, chat, "hola, ¿qué tal?")).text).toBe(help);
    expect((await ask(request, chat, "/inventado")).text).toBe(help);
  });
});

// ---------- Ayudas de los callbacks ----------

/** El message_id que el simulador devolvió a ese sendMessage (el mensaje del teclado). */
const messageIdOf = (body: Body) => (calls.find((c) => c.body === body)?.result as { message_id: number }).message_id;

async function answered(callbackId: string) {
  const find = () => calls.find((c) => c.method === "answerCallbackQuery" && c.body.callback_query_id === callbackId);
  await expect.poll(() => find() !== undefined, { message: "answerCallbackQuery del botón" }).toBe(true);
  return find()!.body;
}

async function edited(chat: number, n: number) {
  await expect.poll(() => sentTo(chat, "editMessageText").length, { message: `editMessageText (${n})` }).toBeGreaterThanOrEqual(n);
  return sentTo(chat, "editMessageText")[n - 1].body;
}
