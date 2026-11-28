import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { EARLIEST_DAY, EARLIEST_MONTH, addDays } from "../src/lib/dates";
import {
  MADRID, apiClient, cleanUp, dayAt, env, expectedStats, item, mark, marked, openApp, prefix, seed, test, tooLong, wipeAll,
} from "./helpers";

// T19: POST /api/telegram/webhook, de punta a punta, con el usuario de E2E (la demo no se toca).
// Montaje: este archivo arranca un simulador de la API de Telegram en TELEGRAM_API_BASE (playwright.config.ts la fija a
// http://127.0.0.1:4545 en local y el webServer la hereda). El simulador registra cada llamada (método y cuerpo) y
// responde como Telegram. Los updates se mandan como Telegram: POST con X-Telegram-Bot-Api-Secret-Token.
// Los chats son ficticios, grandes y aleatorios. Ni el token ni el secreto se imprimen nunca: se comparan con booleanos.
// Fuera de alcance aquí (revisión por inspección): 503 sin TELEGRAM_WEBHOOK_SECRET (exige otro servidor), la
// comparación en tiempo constante, que no se use service_role y que handleUpdate tenga sus tests unitarios.
// T27 (al final del archivo): /habitos, el menú de cada hábito, el calendario del historial y borrar, con el mismo simulador.
// T28 (después de T27): /nuevo y la paleta, renombrar, /ejemplo, /cancelar y la /ayuda completa, con el mismo simulador.

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
  // T27: ningún botón pasa de 64 bytes y nada de lo que dice el bot lleva un error crudo de la BD ni un estado de una RPC.
  const long = calls.flatMap((c) => buttons(c.body)).filter((b) => Buffer.byteLength(b.callback_data ?? "") > 64);
  expect(long, "callback_data de más de 64 bytes").toEqual([]);
  const said = calls.flatMap((c) => (typeof c.body.text === "string" ? [c.body.text] : []));
  expect(said.filter((t) => RAW.test(t)), "textos con el error crudo o el estado de la RPC").toEqual([]);
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
      for (const text of [`/start ${code}`, "/hoy", "/habitos", "/ayuda"]) {
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

// ---------- T27: el bot ve y marca todo ----------
// Contrato que fijan estos tests (texto plano; callback_data ≤ 64 bytes):
//   /habitos            → «Tus hábitos:» + un bloque por hábito (statsBlock) y un botón «<nombre>» → h:<id> por hábito.
//                          Sin hábitos: un texto que empieza por «Aún no tienes hábitos.» y un solo botón «Cargar datos de ejemplo» → s.
//   h:<id>              → menú: statsBlock y «📅 Historial» m:<id>:<YYYY-MM de hoy> · «✏️ Renombrar» r:<id> · «🗑️ Borrar» x:<id> · «⬅️ Volver» l.
//   l                   → la lista.   s → telegram_load_sample y la lista.
//   m:<id>:<YYYY-MM>    → calendario: texto statsBlock; fila «‹» m:<id>:<mes anterior> / «<Mes> de <año>» / «›» m:<id>:<mes siguiente>
//                          (ningún botón lleva fuera de 2000-01…mes de hoy); fila L M X J V S D; semanas de 7 botones de lunes a
//                          domingo; día pasado o de hoy → d:<id>:<YYYY-MM-DD>:<1 marcar | 0 desmarcar>, siempre con su número y,
//                          si está marcado, además «✅» (T27-r1 F-1); huecos y futuros sin d: (no hacen nada); debajo, «⬅️ Volver» → h:<id>.
//   d:<id>:<día>:<1|0>  → «Marcado» / «Desmarcado» y edita el calendario (con las estadísticas al día).
//   x:<id>              → «¿Borrar «<nombre>» y todo su historial?» con «Sí, borrar» y:<id> y «Cancelar» h:<id>.
//   y:<id>              → borra y edita con la lista (o con el estado vacío).
//   habit_id ajeno o borrado → answerCallbackQuery «Ese hábito ya no existe.» y nada cambia. Mal formada → 200, sin editar ni enviar.

const GONE = "Ese hábito ya no existe.";
const LIST_HEADER = "Tus hábitos:";
const EMPTY_LIST = "Aún no tienes hábitos.";
const SAMPLE = "Cargar datos de ejemplo";
const SAMPLE_NAMES = ["Beber 2 litros de agua", "Caminar 30 minutos", "Leer 20 minutos"];
const WEEK = ["L", "M", "X", "J", "V", "S", "D"];
/** Errores crudos de PostgREST/Postgres y estados de las RPC que nunca deben llegar al usuario (S-1 de T26-r1). */
const RAW = /violates|duplicate key|invalid input|syntax error|constraint|PGRST|\b(?:22|23|42|P0)[0-9A-Z]{3}\b|not_linked|not_found|out_of_range|no_pending|not_empty|^(?:ok|invalid|duplicate|limit|create|rename)$/i;

const menuButtons = (id: string, month: string) => [
  { text: "📅 Historial", callback_data: `m:${id}:${month}` },
  { text: "✏️ Renombrar", callback_data: `r:${id}` },
  { text: "🗑️ Borrar", callback_data: `x:${id}` },
  { text: "⬅️ Volver", callback_data: "l" },
];

type BotHabit = { habit_id: string; name: string; color: string; days: string[]; today: string };

/** Lo que ve el bot (telegram_habits, aprobada en T26): los hábitos en el orden de la web, sus días y el «hoy» del vínculo. */
async function botHabits(chat: number) {
  const { data, error } = await apiClient().rpc("telegram_habits", { p_secret: env("TELEGRAM_WEBHOOK_SECRET"), p_chat_id: chat });
  if (error) throw new Error(`telegram_habits falló: ${error.code} ${error.message}`);
  return data as BotHabit[];
}
const habitRow = async (chat: number, id: string) => (await botHabits(chat)).find((r) => r.habit_id === id)!;

/** El espacio duro vale como espacio. */
const plain = (text: unknown) => String(text ?? "").replace(/\u00a0/g, " ");
/** «<nombre>\nRacha actual: 3 días\nMejor racha: 5 días\nÚltimos 30 días: 27 %», con src/lib/streak.ts como la web. */
const statsBlock = (name: string, marks: string[], today: string) =>
  [name, ...Object.entries(expectedStats(marks, today)).map(([k, v]) => `${k}: ${v}`)].join("\n");

const keyboard = (body: Body): Button[][] =>
  ((body.reply_markup as { inline_keyboard?: Button[][] } | undefined)?.inline_keyboard ?? []).map((row) =>
    row.map(({ text, callback_data }) => ({ text, callback_data })),
  );

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
/** Las celdas del mes de lunes a domingo: null es un hueco. */
function monthCells(month: string) {
  const offset = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (number | null)[] = [...Array<null>(offset).fill(null), ...Array.from({ length: daysIn(month) }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return cells;
}
/** Los títulos de mes que enseñan las ediciones posteriores a la n.º `from`. */
const titlesAfter = (chat: number, from: number) =>
  sentTo(chat, "editMessageText").slice(from).flatMap((e) => keyboard(e.body)[0]?.map((b) => b.text) ?? []);

function expectList(body: Body, rows: BotHabit[]) {
  expect(plain(body.text), "el texto de la lista").toBe([LIST_HEADER, ...rows.map((r) => statsBlock(r.name, r.days, r.today))].join("\n\n"));
  expect(buttons(body), "un botón por hábito, en el orden de la web").toEqual(rows.map((r) => ({ text: r.name, callback_data: `h:${r.habit_id}` })));
}

function expectMenu(body: Body, row: BotHabit) {
  expect(plain(body.text), "el texto del menú").toBe(statsBlock(row.name, row.days, row.today));
  expect(buttons(body), "los botones del menú").toEqual(menuButtons(row.habit_id, row.today.slice(0, 7)));
}

function expectCalendar(body: Body, row: BotHabit, month: string) {
  const { habit_id: id, today } = row;
  const current = today.slice(0, 7);
  const kb = keyboard(body);
  const at = `calendario de ${month}`;
  expect(plain(body.text), `${at}: el nombre y las estadísticas al día`).toBe(statsBlock(row.name, row.days, today));
  const nav = kb[0] ?? [];
  expect(nav.map((b) => b.text), `${at}: la fila de navegación tiene el título`).toContain(monthTitle(month));
  if (month > EARLIEST_MONTH) expect(nav.find((b) => b.text === "‹")?.callback_data, `${at}: «‹»`).toBe(`m:${id}:${shiftMonth(month, -1)}`);
  if (month < current) expect(nav.find((b) => b.text === "›")?.callback_data, `${at}: «›»`).toBe(`m:${id}:${shiftMonth(month, 1)}`);
  const targets = kb.flat().flatMap((b) => b.callback_data.match(/^m:[^:]+:(\d{4}-\d{2})$/)?.slice(1) ?? []);
  expect(targets.filter((m) => m < EARLIEST_MONTH || m > current), `${at}: ningún botón lleva fuera de 2000-01…${current}`).toEqual([]);
  expect(kb[1]?.map((b) => b.text), `${at}: la fila de los días de la semana`).toEqual(WEEK);
  const cells = monthCells(month);
  const weeks = kb.slice(2, 2 + cells.length / 7);
  expect(weeks.map((w) => w.length), `${at}: ${cells.length / 7} semanas de 7 botones`).toEqual(Array(cells.length / 7).fill(7));
  weeks.flat().forEach((b, i) => {
    const d = cells[i];
    if (d === null) {
      expect(b.text, `${at}: hueco n.º ${i} sin número`).not.toMatch(/\d|✅/);
      expect(b.callback_data, `${at}: hueco n.º ${i} no marca`).not.toMatch(/^d:/);
      return;
    }
    const day = iso(month, d);
    if (day > today) {
      expect(b.callback_data, `${day} es futuro: no marca`).not.toMatch(/^d:/);
      expect(b.text, `${day} es futuro`).not.toContain("✅");
      return;
    }
    const done = row.days.includes(day);
    expect(b.callback_data, day).toBe(`d:${id}:${day}:${done ? 0 : 1}`);
    if (done) {
      expect(b.text, `${day} marcado`).toContain("✅");
      // T27-r1 F-1: el marcado conserva su número, como en la web; si no, una semana entera de «✅» no dice qué día es cada uno.
      expect(b.text, `${day} marcado con su número`).toMatch(new RegExp(`(^|\\D)${d}(\\D|$)`));
    } else if (day === today) {
      expect(b.text, `${day} (hoy) sin marcar`).not.toContain("✅");
      expect(b.text, `${day} (hoy) con su número`).toMatch(new RegExp(`(^|\\D)${d}(\\D|$)`));
    } else expect(b.text, `${day} sin marcar: su número`).toBe(String(d));
  });
  expect(kb.slice(2 + cells.length / 7).flat(), `${at}: «⬅️ Volver» al menú`).toContainEqual({ text: "⬅️ Volver", callback_data: `h:${id}` });
}

/** Pulsa un botón: 200, espera su answerCallbackQuery y da cómo esperar la edición del mismo mensaje. */
async function press(request: APIRequestContext, chat: number, data: string, messageId: number) {
  const before = sentTo(chat, "editMessageText").length;
  const cb = callback(chat, data, messageId);
  expect((await post(request, cb.update)).status(), `«${data}» → 200`).toBe(200);
  const answer = await answered(cb.id);
  return {
    answer,
    before,
    edit: async () => {
      const body = await edited(chat, before + 1);
      expect(Number(body.message_id), `«${data}» edita el mismo mensaje`).toBe(messageId);
      return body;
    },
  };
}

/** Manda un callback sin esperar respuesta (puede ignorarse) y devuelve cuántas ediciones había antes. */
async function pressRaw(request: APIRequestContext, chat: number, data: string, messageId: number) {
  const before = sentTo(chat, "editMessageText").length;
  expect((await post(request, callback(chat, data, messageId).update)).status(), `«${data}» → 200`).toBe(200);
  return before;
}

async function expectNoEdit(chat: number, before: number, what: string) {
  await settle();
  expect(sentTo(chat, "editMessageText").length, `${what}: no edita el mensaje`).toBe(before);
}

/** Siembra hábitos «e2e-…-<sufijo>», vincula un chat nuevo y devuelve el «hoy» del vínculo. */
async function linkedWith(request: APIRequestContext, api: SupabaseClient, ...suffixes: string[]) {
  const p = prefix();
  const names = suffixes.map((s) => `${p}-${s}`);
  const ids = await seed(api, ...names.map((name) => ({ name })));
  const chat = await linkChat(request, api);
  const today = (await botHabits(chat))[0].today;
  return { chat, ids, names, today, current: today.slice(0, 7) };
}

/** /habitos y el message_id del mensaje con el teclado. */
async function openList(request: APIRequestContext, chat: number) {
  const body = await ask(request, chat, "/habitos");
  return { body, messageId: messageIdOf(body) };
}

/** Hábitos y días del usuario de E2E, para comprobar que algo no cambia. */
async function snapshot(api: SupabaseClient) {
  const h = await api.from("habits").select("id, name, color").order("id");
  const c = await api.from("check_ins").select("habit_id, day").order("habit_id").order("day");
  if (h.error || c.error) throw new Error(`No se pudo leer: ${h.error?.message ?? c.error?.message}`);
  return JSON.stringify([h.data, c.data]);
}

test.describe("T27: /habitos y el menú del hábito", () => {
  test("sin vínculo, /habitos → «Primero vincula tu cuenta…» sin botones", async ({ request }) => {
    const body = await ask(request, fakeChat(), "/habitos");
    expect(body.text).toBe(LINK_FIRST);
    expect(buttons(body)).toEqual([]);
  });

  test("sin hábitos → «Aún no tienes hábitos.…» y un solo botón «Cargar datos de ejemplo» (s); pulsarlo carga los 3 de ejemplo y edita el mensaje con la lista; pulsarlo otra vez no duplica", async ({ request, api }) => {
    await wipeAll(api);
    try {
      const chat = await linkChat(request, api);
      const { body, messageId } = await openList(request, chat);
      expect(plain(body.text).startsWith(EMPTY_LIST), `«${body.text}» empieza por «${EMPTY_LIST}»`).toBe(true);
      expect(buttons(body)).toEqual([{ text: SAMPLE, callback_data: "s" }]);
      const list = await (await press(request, chat, "s", messageId)).edit();
      const rows = await botHabits(chat);
      expect(rows.map((r) => r.name).sort(), "los 3 hábitos de ejemplo").toEqual(SAMPLE_NAMES);
      expectList(list, rows);
      await press(request, chat, "s", messageId);
      await settle();
      expect(await botHabits(chat), "un segundo toque no carga otra vez").toHaveLength(3);
    } finally {
      await wipeAll(api);
    }
  });

  test("con 2 hábitos → «Tus hábitos:» y, por hábito, su nombre literal con «Racha actual», «Mejor racha» y «Últimos 30 días» como la web (hoy del vínculo), y un botón «<nombre>» → h:<id> en el orden de la web", async ({ request, api }) => {
    const { chat, ids: [a, b], today } = await linkedWith(request, api, "<b>*_[x](y)", "normal");
    await mark(api, a, ...[1, 2, 3, 10, 11, 12, 13, 14].map((n) => addDays(today, -n)));
    await mark(api, b, today);
    const { body } = await openList(request, chat);
    const rows = await botHabits(chat);
    expect(rows.map((r) => r.habit_id)).toEqual([a, b]);
    expect(rows[0].days).toEqual(await marked(api, a));
    expectList(body, rows);
    expect(plain(body.text), "sanidad: la racha actual de a").toContain("Racha actual: 3 días");
    expect(plain(body.text), "sanidad: la mejor racha de a").toContain("Mejor racha: 5 días");
  });

  test("h:<id> edita el mensaje con el menú: el nombre, sus estadísticas y «📅 Historial» (m:<id>:<mes de hoy>), «✏️ Renombrar» (r:<id>), «🗑️ Borrar» (x:<id>) y «⬅️ Volver» (l); «⬅️ Volver» vuelve a la lista", async ({ request, api }) => {
    const { chat, ids: [a], today } = await linkedWith(request, api, "menu", "otro");
    await mark(api, a, today, addDays(today, -1));
    const { messageId } = await openList(request, chat);
    expectMenu(await (await press(request, chat, `h:${a}`, messageId)).edit(), await habitRow(chat, a));
    expectList(await (await press(request, chat, "l", messageId)).edit(), await botHabits(chat));
  });
});

test.describe("T27: historial", () => {
  test("📅 Historial → el mes de hoy: «‹» / «<Mes> de <año>», fila L M X J V S D, un botón por día en su columna (✅ los marcados), futuros y huecos sin marcar y «⬅️ Volver»; «›» no pasa del mes de hoy; «‹» abre el mes anterior; «⬅️ Volver» vuelve al menú", async ({ request, api }) => {
    const { chat, ids: [id], today, current } = await linkedWith(request, api, "cal");
    const previous = shiftMonth(current, -1);
    await mark(api, id, ...new Set([today, `${current}-01`, `${previous}-15`]));
    const { messageId } = await openList(request, chat);
    const menu = await (await press(request, chat, `h:${id}`, messageId)).edit();
    const historial = buttons(menu).find((b) => b.text === "📅 Historial")!;
    let row = await habitRow(chat, id);
    const cal = await (await press(request, chat, historial.callback_data, messageId)).edit();
    expectCalendar(cal, row, current);

    const next = keyboard(cal)[0].find((b) => b.text === "›");
    if (next) {
      const before = await pressRaw(request, chat, next.callback_data, messageId);
      await settle();
      expect(titlesAfter(chat, before), "«›» en el mes de hoy no avanza").not.toContain(monthTitle(shiftMonth(current, 1)));
    }

    const back = await (await press(request, chat, keyboard(cal)[0].find((b) => b.text === "‹")!.callback_data, messageId)).edit();
    row = await habitRow(chat, id);
    expectCalendar(back, row, previous);
    const volver = keyboard(back).flat().find((b) => b.text === "⬅️ Volver")!;
    expectMenu(await (await press(request, chat, volver.callback_data, messageId)).edit(), row);
  });

  test("pulsar un día pasado o el de hoy lo marca («Marcado») y otra vez lo desmarca («Desmarcado»): edita el calendario con «✅» y las estadísticas, y la BD cambia; repetir el toque no duplica", async ({ request, api }) => {
    const { chat, ids: [id], today, current } = await linkedWith(request, api, "marcar");
    const previous = shiftMonth(current, -1);
    const day = `${previous}-10`;
    const { messageId } = await openList(request, chat);
    await (await press(request, chat, `m:${id}:${previous}`, messageId)).edit();

    for (let i = 0; i < 2; i++) {
      const tap = await press(request, chat, `d:${id}:${day}:1`, messageId);
      expect(tap.answer.text).toBe("Marcado");
      expectCalendar(await tap.edit(), await habitRow(chat, id), previous);
    }
    expect(await marked(api, id), "un solo check-in").toEqual([day]);
    const unmark = await press(request, chat, `d:${id}:${day}:0`, messageId);
    expect(unmark.answer.text).toBe("Desmarcado");
    expectCalendar(await unmark.edit(), await habitRow(chat, id), previous);
    expect(await marked(api, id)).toEqual([]);

    await (await press(request, chat, `m:${id}:${current}`, messageId)).edit();
    const hoy = await press(request, chat, `d:${id}:${today}:1`, messageId);
    expect(hoy.answer.text).toBe("Marcado");
    const cal = await hoy.edit();
    expectCalendar(cal, await habitRow(chat, id), current);
    expect(plain(cal.text), "la racha cuenta el día de hoy").toContain("Racha actual: 1 día");
    expect(await marked(api, id)).toEqual([today]);
  });

  test("días futuros, huecos, el título y L M X J V S D no hacen nada (answerCallbackQuery, sin editar ni check-in); d: con mañana o con 1999-12-31 tampoco", async ({ request, api }) => {
    const { chat, ids: [id], today, current } = await linkedWith(request, api, "nada");
    const { messageId } = await openList(request, chat);
    const cal = await (await press(request, chat, `m:${id}:${current}`, messageId)).edit();
    const kb = keyboard(cal);
    const inert = new Set(
      [...kb[0].filter((b) => b.text === monthTitle(current)), ...kb[1], ...kb.slice(2).flat().filter((b) => !/^[dmh]:/.test(b.callback_data))]
        .map((b) => b.callback_data),
    );
    for (const data of inert) {
      const { before } = await press(request, chat, data, messageId);
      await expectNoEdit(chat, before, `«${data}»`);
    }
    for (const data of [`d:${id}:${addDays(today, 1)}:1`, `d:${id}:1999-12-31:1`]) {
      await expectNoEdit(chat, await pressRaw(request, chat, data, messageId), `«${data}»`);
    }
    expect(await marked(api, id)).toEqual([]);
  });

  test("navegación entre 2000-01 y el mes de hoy: m:<id>:2000-01 → «Enero de 2000» sin «‹» que retroceda y su 1 de enero se marca; m:<id>:1999-12 y el mes siguiente al de hoy no se muestran", async ({ request, api }) => {
    const { chat, ids: [id], current } = await linkedWith(request, api, "limites");
    const { messageId } = await openList(request, chat);
    const first = await (await press(request, chat, `m:${id}:${EARLIEST_MONTH}`, messageId)).edit();
    expectCalendar(first, await habitRow(chat, id), EARLIEST_MONTH);

    const forbidden = [monthTitle("1999-12"), monthTitle(shiftMonth(current, 1))];
    const prev = keyboard(first)[0].find((b) => b.text === "‹");
    for (const data of [...(prev ? [prev.callback_data] : []), `m:${id}:1999-12`, `m:${id}:${shiftMonth(current, 1)}`]) {
      const before = await pressRaw(request, chat, data, messageId);
      await settle();
      expect(titlesAfter(chat, before).filter((t) => forbidden.includes(t)), `«${data}» no muestra un mes fuera de rango`).toEqual([]);
    }

    await (await press(request, chat, `m:${id}:${EARLIEST_MONTH}`, messageId)).edit();
    const tap = await press(request, chat, `d:${id}:${EARLIEST_DAY}:1`, messageId);
    expect(tap.answer.text).toBe("Marcado");
    expectCalendar(await tap.edit(), await habitRow(chat, id), EARLIEST_MONTH);
    expect(await marked(api, id)).toEqual([EARLIEST_DAY]);
  });

  test.describe("con la web", () => {
    test.use({ timezoneId: MADRID });

    test("lo marcado en el bot se ve en la web al recargar, y lo marcado en la web se ve en el calendario del bot", async ({ request, api, page }) => {
      const { chat, ids: [id], names: [name], current } = await linkedWith(request, api, "web");
      const previous = shiftMonth(current, -1);
      const { messageId } = await openList(request, chat);
      await (await press(request, chat, `m:${id}:${previous}`, messageId)).edit();
      await (await press(request, chat, `d:${id}:${previous}-10:1`, messageId)).edit();

      await page.goto(`/app/habitos/${id}?mes=${previous}`);
      await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
      const dayButton = (d: number) => page.getByRole("button", { name: `${d} de ${monthName(previous)}`, exact: true });
      await expect(dayButton(10), "la web ve el día que marcó el bot").toHaveAttribute("aria-pressed", "true");
      await dayButton(12).click();
      await expect.poll(() => marked(api, id), { message: "la web guarda el 12" }).toEqual([`${previous}-10`, `${previous}-12`]);

      const cal = await (await press(request, chat, `m:${id}:${previous}`, messageId)).edit();
      expectCalendar(cal, await habitRow(chat, id), previous);
      const twelve = keyboard(cal).flat().find((b) => b.callback_data === `d:${id}:${previous}-12:0`);
      expect(twelve?.text, "el bot ve el día que marcó la web").toContain("✅");
    });
  });
});

test.describe("T27: borrar", () => {
  test("🗑️ Borrar → «¿Borrar «<nombre>» y todo su historial?» con «Sí, borrar» (y:<id>) y «Cancelar» (h:<id>); «Cancelar» vuelve al menú sin borrar", async ({ request, api }) => {
    const { chat, ids: [id], names: [name] } = await linkedWith(request, api, "borrar");
    const { messageId } = await openList(request, chat);
    await (await press(request, chat, `h:${id}`, messageId)).edit();
    const confirm = await (await press(request, chat, `x:${id}`, messageId)).edit();
    expect(plain(confirm.text)).toBe(`¿Borrar «${name}» y todo su historial?`);
    expect(buttons(confirm)).toEqual([
      { text: "Sí, borrar", callback_data: `y:${id}` },
      { text: "Cancelar", callback_data: `h:${id}` },
    ]);
    expectMenu(await (await press(request, chat, `h:${id}`, messageId)).edit(), await habitRow(chat, id));
    expect((await api.from("habits").select("id").eq("id", id)).data).toHaveLength(1);
  });

  test("«Sí, borrar» borra el hábito y su historial (la web ya no los ve) y vuelve a la lista; con el último, a «Aún no tienes hábitos.»; repetirlo → «Ese hábito ya no existe.»", async ({ request, api }) => {
    await wipeAll(api); // el estado vacío del final exige que no haya otros hábitos
    const { chat, ids: [one, two], today } = await linkedWith(request, api, "uno", "dos");
    await mark(api, one, today, addDays(today, -1));
    const { messageId } = await openList(request, chat);
    await (await press(request, chat, `x:${one}`, messageId)).edit();
    const list = await (await press(request, chat, `y:${one}`, messageId)).edit();
    expect((await api.from("habits").select("id").eq("id", one)).data, "el hábito ya no está").toEqual([]);
    expect(await marked(api, one), "ni su historial").toEqual([]);
    expectList(list, await botHabits(chat));
    expect(buttons(list).map((x) => x.callback_data)).toEqual([`h:${two}`]);

    expect((await press(request, chat, `y:${one}`, messageId)).answer.text).toBe(GONE);

    await (await press(request, chat, `x:${two}`, messageId)).edit();
    const empty = await (await press(request, chat, `y:${two}`, messageId)).edit();
    expect(plain(empty.text).startsWith(EMPTY_LIST), `«${empty.text}»`).toBe(true);
    expect(buttons(empty)).toEqual([{ text: SAMPLE, callback_data: "s" }]);
  });
});

test.describe("T27: seguridad", () => {
  let demo: SupabaseClient;
  let demoHabit: string | undefined;
  const demoState = async () =>
    demoHabit ? JSON.stringify([(await demo.from("habits").select("id, name, color").eq("id", demoHabit)).data, await marked(demo, demoHabit)]) : "";

  test.beforeAll(async () => {
    // La demo solo se lee: no se vincula ni se escribe nada en ella.
    demo = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await demo.auth.signInWithPassword({ email: env("DEMO_EMAIL"), password: env("DEMO_PASSWORD") });
    if (error) throw new Error(`No se pudo iniciar sesión como la demo: ${error.message}`);
    demoHabit = (await demo.from("habits").select("id").limit(1)).data?.[0]?.id;
  });

  test.afterAll(async () => {
    await demo.auth.signOut({ scope: "local" });
  });

  test("un habit_id ajeno (de la demo) o inexistente en h:, m:, d:, x: e y: → «Ese hábito ya no existe.» y nada cambia, ni en la demo", async ({ request, api }) => {
    const { chat, today, current } = await linkedWith(request, api, "propio");
    const { messageId } = await openList(request, chat);
    const before = await snapshot(api);
    const demoBefore = await demoState();
    for (const foreign of [randomUUID(), ...(demoHabit ? [demoHabit] : [])]) {
      const whose = foreign === demoHabit ? "de la demo" : "inexistente";
      for (const data of [`h:${foreign}`, `m:${foreign}:${current}`, `d:${foreign}:${today}:1`, `d:${foreign}:${today}:0`, `x:${foreign}`, `y:${foreign}`]) {
        expect((await press(request, chat, data, messageId)).answer.text, `«${data.slice(0, 2)}» con un hábito ${whose}`).toBe(GONE);
      }
    }
    expect(await snapshot(api)).toBe(before);
    expect(await demoState(), "la demo no cambia").toBe(demoBefore);
  });

  test("S-1: el hábito se borra en la web con el calendario abierto → pulsar un día, el menú, «🗑️ Borrar» o «Sí, borrar» da «Ese hábito ya no existe.», 200 y sin check-in", async ({ request, api }) => {
    const { chat, ids: [id], today, current } = await linkedWith(request, api, "carrera");
    const { messageId } = await openList(request, chat);
    await (await press(request, chat, `m:${id}:${current}`, messageId)).edit();
    await api.from("habits").delete().eq("id", id);
    for (const data of [`d:${id}:${today}:1`, `m:${id}:${current}`, `h:${id}`, `x:${id}`, `y:${id}`]) {
      expect((await press(request, chat, data, messageId)).answer.text, `«${data.slice(0, 2)}» tras borrarlo`).toBe(GONE);
    }
    expect(await marked(api, id)).toEqual([]);
  });

  test("callback_data mal formada (también de más de 64 bytes) → 200, sin editar, sin enviar mensajes y sin cambios", async ({ request, api }) => {
    const { chat, ids: [id], today, current } = await linkedWith(request, api, "malformada");
    const { messageId } = await openList(request, chat);
    const before = await snapshot(api);
    const sent = sentTo(chat).length;
    const edits = sentTo(chat, "editMessageText").length;
    const bad = [
      "h:", "h:no-es-un-uuid", `h:${id}x`, `h:${id}:x`, `H:${id}`, `m:${id}`, `m:${id}:2026-1`, `m:${id}:2026-13`, `m:${id}:${current}:x`,
      `d:${id}:${today}`, `d:${id}:${today}:2`, `d:${id}:2026-02-30:1`, `d:${id}:${today.replaceAll("-", "")}:1`, `d:no-es-un-uuid:${today}:1`,
      `x:${id}:x`, "x:", "y:", `y:${id}x`, "l:x", "s:x", "z", `h:${id}${"x".repeat(64)}`,
    ];
    for (const data of bad) await pressRaw(request, chat, data, messageId);
    await settle();
    expect(sentTo(chat, "editMessageText").length, "no edita").toBe(edits);
    expect(sentTo(chat).length, "no envía mensajes").toBe(sent);
    expect(await snapshot(api)).toBe(before);
  });

  test("sin vínculo, los botones nuevos (h:, m:, d:, x:, y:, l, s) lo dicen en el callback y no tocan nada", async ({ request, api }) => {
    const [id] = await seed(api, { name: `${prefix()}-ajeno` });
    const before = await snapshot(api);
    const stranger = fakeChat();
    const today = dayAt(MADRID, new Date());
    for (const data of [`h:${id}`, `m:${id}:${today.slice(0, 7)}`, `d:${id}:${today}:1`, `x:${id}`, `y:${id}`, "l", "s"]) {
      const { answer } = await press(request, stranger, data, 1);
      expect(String(answer.text ?? "").trim(), `«${data.slice(0, 2)}» sin vínculo dice algo`).not.toBe("");
      expect(answer.text).not.toBe("Marcado");
    }
    expect(await snapshot(api)).toBe(before);
  });
});

// ---------- T28: el bot crea y renombra ----------
// Contrato que fijan estos tests (texto plano; callback_data ≤ 64 bytes; los mensajes de error, los de la web):
//   /nuevo <nombre>     → (trim) válido: «Elige un color para «<nombre>».» con 6 botones, en este orden, cuyo texto empieza por
//                          🔴 🟠 🟡 🟢 🔵 🟣 y cuyo callback_data es k:red · k:orange · k:amber · k:green · k:blue · k:violet.
//                          No válido: «Escribe un nombre» / «Máximo 60 caracteres» / «Ya tienes un hábito con ese nombre.» /
//                          «Has llegado al máximo de 50 hábitos.», sin botones.
//   /nuevo              → «Escribe el nombre del hábito nuevo.»; el siguiente texto es el nombre (como /nuevo <nombre>).
//   k:<color>           → answerCallbackQuery y crea con el nombre pendiente; dice (mensaje nuevo o edición) «Hábito «<nombre>» creado.».
//                          Si entre medias el nombre se duplicó o se llegó a 50 → el mensaje de la web (en el toast o en un mensaje).
//                          Sin nada pendiente → lo dice en el callback y no crea. k: fuera de la paleta o mal formada → 200 y nada.
//   r:<id>              → «Escribe el nuevo nombre de «<nombre>».» (mensaje nuevo o edición); el siguiente texto (trim) lo renombra:
//                          «Hábito renombrado a «<nuevo>».». No válido o duplicado → el mensaje de la web y sigue esperando el nombre.
//                          Hábito borrado entre medias → «Ese hábito ya no existe.».
//   /ejemplo            → cuenta vacía: «Datos de ejemplo cargados.» y los 3 hábitos; si no: «Ya tienes hábitos: los datos de ejemplo
//                          solo se cargan en una cuenta vacía.».
//   /cancelar           → «Cancelado.» si había algo pendiente; si no, «No había nada que cancelar.».
//   Cualquier comando cancela lo pendiente antes de ejecutarse (S-2). Texto sin nada pendiente → la ayuda.
//   Fuera de alcance aquí: la caducidad de 10 minutos (fase A de T26; el bot solo pregunta a telegram_pending_action).

const ASK_NAME = "Escribe el nombre del hábito nuevo.";
const pickColor = (name: string) => `Elige un color para «${name}».`;
const created = (name: string) => `Hábito «${name}» creado.`;
const askRename = (name: string) => `Escribe el nuevo nombre de «${name}».`;
const renamed = (name: string) => `Hábito renombrado a «${name}».`;
const EMPTY_NAME = "Escribe un nombre";
const TOO_LONG = "Máximo 60 caracteres";
const DUPLICATE = "Ya tienes un hábito con ese nombre.";
const LIMIT = "Has llegado al máximo de 50 hábitos.";
const SAMPLE_LOADED = "Datos de ejemplo cargados.";
const SAMPLE_NOT_EMPTY = "Ya tienes hábitos: los datos de ejemplo solo se cargan en una cuenta vacía.";
const CANCELLED = "Cancelado.";
const NOTHING_TO_CANCEL = "No había nada que cancelar.";
const ALL_COMMANDS = ["/hoy", "/habitos", "/nuevo", "/ejemplo", "/cancelar", "/vincular", "/desvincular", "/ayuda"];
const PALETTE = [["🔴", "red"], ["🟠", "orange"], ["🟡", "amber"], ["🟢", "green"], ["🔵", "blue"], ["🟣", "violet"]] as const;

/** Lo que el bot le dice al chat (mensajes nuevos y ediciones) a partir de la llamada n.º `from` del simulador. */
const saidSince = (chat: number, from: number) =>
  calls
    .slice(from)
    .filter((c) => ["sendMessage", "editMessageText"].includes(c.method) && String(c.body.chat_id) === String(chat))
    .map((c) => plain(c.body.text));

async function expectSaid(chat: number, from: number, text: string, what: string) {
  await expect.poll(() => saidSince(chat, from), { message: `${what}: «${text}»` }).toContain(text);
}

/** Manda un texto y espera que el bot conteste exactamente `text` en un mensaje nuevo. Devuelve ese mensaje. */
async function expectReply(request: APIRequestContext, chat: number, input: string, text: string) {
  const body = await ask(request, chat, input);
  expect(plain(body.text), `«${input.slice(0, 40)}» →`).toBe(text);
  return body;
}

function expectPalette(body: Body, name: string) {
  expect(plain(body.text), "el texto de la paleta").toBe(pickColor(name));
  const kb = buttons(body);
  expect(kb.map((b) => b.callback_data), "los 6 colores de la paleta, en orden").toEqual(PALETTE.map(([, c]) => `k:${c}`));
  kb.forEach((b, i) => expect(b.text.startsWith(PALETTE[i][0]), `«${b.text}» empieza por ${PALETTE[i][0]}`).toBe(true));
}

/** Pulsa un botón y espera que el bot diga `text`, en el toast del callback o en un mensaje (nuevo o editado). */
async function tapSays(request: APIRequestContext, chat: number, data: string, messageId: number, text: string) {
  const from = calls.length;
  const cb = callback(chat, data, messageId);
  expect((await post(request, cb.update)).status(), `«${data}» → 200`).toBe(200);
  const answer = await answered(cb.id);
  await expect
    .poll(() => [plain(answer.text), ...saidSince(chat, from)], { message: `«${data}» dice «${text}»` })
    .toContain(text);
}

/** Pulsa «✏️ Renombrar» (r:<id>) y espera la pregunta por el nombre nuevo. */
async function startRename(request: APIRequestContext, chat: number, id: string, name: string, messageId: number) {
  const from = calls.length;
  await press(request, chat, `r:${id}`, messageId);
  await expectSaid(chat, from, askRename(name), "pide el nombre nuevo");
}

/** Los hábitos del usuario de E2E con ese nombre (ilike). */
async function named(api: SupabaseClient, name: string) {
  const { data, error } = await api.from("habits").select("id, name, color").ilike("name", name);
  if (error) throw new Error(`No se pudo leer: ${error.message}`);
  return data;
}
const nameOf = async (api: SupabaseClient, id: string) => (await api.from("habits").select("name").eq("id", id)).data;

async function fillTo(api: SupabaseClient, target: number, tag: string) {
  const { count, error } = await api.from("habits").select("id", { count: "exact", head: true });
  if (error || count === null) throw new Error(`No se pudo contar: ${error?.message}`);
  const rows = Array.from({ length: target - count }, (_, i) => ({ name: `${tag}-relleno-${i + 1}` }));
  if (rows.length && (await api.from("habits").insert(rows)).error) throw new Error(`No se pudo llegar a ${target}`);
}

/** /nuevo <nombre> en un chat vinculado: comprueba la paleta y devuelve su message_id. */
async function startNew(request: APIRequestContext, chat: number, name: string) {
  const body = await ask(request, chat, `/nuevo ${name}`);
  expectPalette(body, name);
  return messageIdOf(body);
}

/** Toca un color y espera «Hábito «<nombre>» creado.». */
async function pickAndCreate(request: APIRequestContext, chat: number, color: string, messageId: number, name: string) {
  const from = calls.length;
  await press(request, chat, `k:${color}`, messageId);
  await expectSaid(chat, from, created(name), `k:${color} confirma`);
}

test.describe("T28: /nuevo", () => {
  test("/nuevo <nombre> → «Elige un color para «<nombre>».» con 🔴 🟠 🟡 🟢 🔵 🟣 (k:red…k:violet); al tocar 🔵 crea el hábito azul y dice «Hábito «<nombre>» creado.»", async ({ request, api }) => {
    const { chat } = await linkedWith(request, api, "ya");
    const name = `${prefix()}-nuevo con espacios`;
    const messageId = await startNew(request, chat, name);
    expect(await named(api, name), "elegir el color es lo que crea").toEqual([]);
    await pickAndCreate(request, chat, "blue", messageId, name);
    expect((await named(api, name)).map((h) => ({ name: h.name, color: h.color }))).toEqual([{ name, color: "blue" }]);
    expect((await botHabits(chat)).map((r) => r.name).at(-1), "el bot lo ve al final de la lista").toBe(name);
  });

  test("S-3: «/nuevo   <nombre>   » quita los espacios sobrantes: la paleta y el hábito llevan el nombre limpio", async ({ request, api }) => {
    const chat = await linkChat(request, api);
    const name = `${prefix()}-limpio`;
    const body = await ask(request, chat, `/nuevo    ${name}    `);
    expectPalette(body, name);
    await pickAndCreate(request, chat, "red", messageIdOf(body), name);
    expect((await named(api, `%${name}%`)).map((h) => h.name), "sin espacios en la BD").toEqual([name]);
  });

  test("/nuevo a secas → «Escribe el nombre del hábito nuevo.» sin botones; el siguiente texto (con espacios sobrantes) es el nombre y sale la paleta; 🟣 lo crea violeta", async ({ request, api }) => {
    const chat = await linkChat(request, api);
    expect(buttons(await expectReply(request, chat, "/nuevo", ASK_NAME))).toEqual([]);
    const name = `${prefix()}-a secas`;
    const palette = await ask(request, chat, `  ${name}  `);
    expectPalette(palette, name);
    await pickAndCreate(request, chat, "violet", messageIdOf(palette), name);
    expect((await named(api, name)).map((h) => h.color)).toEqual(["violet"]);
  });

  test("los 6 colores de la paleta se guardan como en la web (red, orange, amber, green, blue, violet)", async ({ request, api }) => {
    const chat = await linkChat(request, api);
    const p = prefix();
    for (const [, color] of PALETTE) {
      const name = `${p}-${color}`;
      await pickAndCreate(request, chat, color, await startNew(request, chat, name), name);
      expect((await named(api, name)).map((h) => h.color), name).toEqual([color]);
    }
  });

  test("nombre no válido como la web: 61 caracteres → «Máximo 60 caracteres»; duplicado sin mayúsculas → «Ya tienes un hábito con ese nombre.»; solo espacios tras /nuevo → «Escribe un nombre»; sin paleta ni hábito", async ({ request, api }) => {
    const { chat, names: [existing] } = await linkedWith(request, api, "existe");
    const before = await snapshot(api);
    const p = prefix();
    expect(buttons(await expectReply(request, chat, `/nuevo ${tooLong(p)}`, TOO_LONG))).toEqual([]);
    expect(buttons(await expectReply(request, chat, `/nuevo ${existing.toUpperCase()}`, DUPLICATE))).toEqual([]);
    await expectReply(request, chat, "/nuevo", ASK_NAME);
    expect(buttons(await expectReply(request, chat, tooLong(p), TOO_LONG)), "también como texto tras /nuevo").toEqual([]);
    await expectReply(request, chat, "/nuevo", ASK_NAME);
    expect(buttons(await expectReply(request, chat, "   ", EMPTY_NAME)), "solo espacios").toEqual([]);
    expect(await snapshot(api)).toBe(before);
  });

  test("60 caracteres sí valen: la paleta y se crea con el nombre entero", async ({ request, api }) => {
    const chat = await linkChat(request, api);
    const name = tooLong(prefix()).slice(0, 60);
    await pickAndCreate(request, chat, "green", await startNew(request, chat, name), name);
    expect((await named(api, name)).map((h) => h.name)).toEqual([name]);
  });

  test("el límite: con 50 hábitos, /nuevo <nombre> → «Has llegado al máximo de 50 hábitos.» sin paleta; con 49 y la web ocupando el hueco antes del color → el mismo mensaje y sigue en 50", async ({ request, api }) => {
    await wipeAll(api);
    try {
      const p = prefix();
      await fillTo(api, 50, p);
      const chat = await linkChat(request, api);
      expect(buttons(await expectReply(request, chat, `/nuevo ${p}-51`, LIMIT))).toEqual([]);
      await api.from("habits").delete().eq("name", `${p}-relleno-1`);
      const messageId = await startNew(request, chat, `${p}-bot`);
      expect((await api.from("habits").insert({ name: `${p}-web` })).error, "la web ocupa el n.º 50").toBeNull();
      await tapSays(request, chat, "k:blue", messageId, LIMIT);
      expect(await named(api, `${p}-bot`)).toEqual([]);
      const { count } = await api.from("habits").select("id", { count: "exact", head: true });
      expect(count).toBe(50);
    } finally {
      await wipeAll(api);
    }
  });

  test("duplicado entre el nombre y el color (la web crea el mismo nombre) → «Ya tienes un hábito con ese nombre.» y no hay dos", async ({ request, api }) => {
    const chat = await linkChat(request, api);
    const name = `${prefix()}-carrera`;
    const messageId = await startNew(request, chat, name);
    await seed(api, { name });
    await tapSays(request, chat, "k:orange", messageId, DUPLICATE);
    expect(await named(api, name)).toHaveLength(1);
  });

  test("doble toque en el color (dos callbacks a la vez) → un solo hábito; un tercer toque después tampoco crea otro", async ({ request, api }) => {
    const chat = await linkChat(request, api);
    const name = `${prefix()}-doble`;
    const messageId = await startNew(request, chat, name);
    const taps = [callback(chat, "k:amber", messageId), callback(chat, "k:amber", messageId)];
    const responses = await Promise.all(taps.map((t) => post(request, t.update)));
    expect(responses.map((r) => r.status())).toEqual([200, 200]);
    for (const t of taps) await answered(t.id);
    await press(request, chat, "k:amber", messageId);
    await settle();
    expect((await named(api, name)).map((h) => h.color), "un solo hábito").toEqual(["amber"]);
  });

  test("un color sin nada pendiente → el callback dice algo y no crea nada; k: fuera de la paleta o mal formada → 200, sin editar, sin enviar y sin crear", async ({ request, api }) => {
    const { chat } = await linkedWith(request, api, "solo");
    const { messageId } = await openList(request, chat);
    const before = await snapshot(api);
    const { answer } = await press(request, chat, "k:red", messageId);
    expect(String(answer.text ?? "").trim(), "sin pendiente: dice algo").not.toBe("");
    await startNew(request, chat, `${prefix()}-mal`);
    const sent = sentTo(chat).length;
    const edits = sentTo(chat, "editMessageText").length;
    for (const data of ["k:pink", "k:", "k", "k:red:x", "K:red", "k:RED", `k:${"red".repeat(30)}`]) await pressRaw(request, chat, data, messageId);
    await settle();
    expect(sentTo(chat, "editMessageText").length, "no edita").toBe(edits);
    expect(sentTo(chat).length, "no envía mensajes").toBe(sent);
    expect(await snapshot(api)).toBe(before);
  });
});

test.describe("T28: renombrar", () => {
  test("«✏️ Renombrar» (r:<id>) → «Escribe el nuevo nombre de «<nombre>».»; el siguiente texto, sin espacios sobrantes, lo renombra y dice «Hábito renombrado a «<nuevo>».»; otro texto después → la ayuda", async ({ request, api }) => {
    const { chat, ids: [id], names: [name] } = await linkedWith(request, api, "viejo", "otro");
    const { messageId } = await openList(request, chat);
    await (await press(request, chat, `h:${id}`, messageId)).edit();
    await startRename(request, chat, id, name, messageId);
    const next = `${prefix()}-renombrado`;
    await expectReply(request, chat, `   ${next}   `, renamed(next));
    expect(await nameOf(api, id), "renombrado y sin espacios").toEqual([{ name: next }]);
    const help = String((await ask(request, chat, "/ayuda")).text);
    expect((await ask(request, chat, `${prefix()}-otra-vez`)).text, "ya no queda nada pendiente").toBe(help);
    expect(await nameOf(api, id)).toEqual([{ name: next }]);
  });

  test("mismas validaciones: solo espacios, 61 caracteres y un duplicado sin mayúsculas → el mensaje de la web y sigue esperando; luego un nombre válido renombra", async ({ request, api }) => {
    const { chat, ids: [id], names: [name, other] } = await linkedWith(request, api, "uno", "dos");
    const { messageId } = await openList(request, chat);
    await startRename(request, chat, id, name, messageId);
    await expectReply(request, chat, "   ", EMPTY_NAME);
    await expectReply(request, chat, tooLong(prefix()), TOO_LONG);
    await expectReply(request, chat, other.toUpperCase(), DUPLICATE);
    expect(await nameOf(api, id), "sin cambios").toEqual([{ name }]);
    const next = `${prefix()}-bien`;
    await expectReply(request, chat, next, renamed(next));
    expect(await nameOf(api, id)).toEqual([{ name: next }]);
  });

  test("el hábito se borra en la web entre «✏️ Renombrar» y el nombre → «Ese hábito ya no existe.» y no se crea nada", async ({ request, api }) => {
    const { chat, ids: [id], names: [name] } = await linkedWith(request, api, "borrado");
    const { messageId } = await openList(request, chat);
    await startRename(request, chat, id, name, messageId);
    await api.from("habits").delete().eq("id", id);
    const next = `${prefix()}-tarde`;
    await expectReply(request, chat, next, GONE);
    expect(await named(api, next)).toEqual([]);
  });

  test("r:<id> con un hábito inexistente → «Ese hábito ya no existe.» y el texto siguiente es la ayuda", async ({ request, api }) => {
    const { chat } = await linkedWith(request, api, "solo");
    const { messageId } = await openList(request, chat);
    expect((await press(request, chat, `r:${randomUUID()}`, messageId)).answer.text).toBe(GONE);
    const help = String((await ask(request, chat, "/ayuda")).text);
    const before = await snapshot(api);
    expect((await ask(request, chat, `${prefix()}-nada`)).text).toBe(help);
    expect(await snapshot(api)).toBe(before);
  });
});

test.describe("T28: /cancelar y S-2 (cualquier comando cancela lo pendiente)", () => {
  test("/cancelar sin nada pendiente → «No había nada que cancelar.»; tras /nuevo → «Cancelado.» y el texto siguiente es la ayuda, no un nombre", async ({ request, api }) => {
    const chat = await linkChat(request, api);
    await expectReply(request, chat, "/cancelar", NOTHING_TO_CANCEL);
    await expectReply(request, chat, "/nuevo", ASK_NAME);
    await expectReply(request, chat, "/cancelar", CANCELLED);
    const help = String((await ask(request, chat, "/ayuda")).text);
    const after = await ask(request, chat, `${prefix()}-cancelado`);
    expect(after.text, "ya no es un nombre").toBe(help);
    expect(buttons(after), "sin paleta").toEqual([]);
    await expectReply(request, chat, "/cancelar", NOTHING_TO_CANCEL);
  });

  test("/cancelar con la paleta abierta → «Cancelado.» y tocar el color ya no crea nada", async ({ request, api }) => {
    const chat = await linkChat(request, api);
    const name = `${prefix()}-sin-color`;
    const messageId = await startNew(request, chat, name);
    await expectReply(request, chat, "/cancelar", CANCELLED);
    const { answer } = await press(request, chat, "k:green", messageId);
    expect(String(answer.text ?? "").trim(), "dice algo").not.toBe("");
    await settle();
    expect(await named(api, name)).toEqual([]);
  });

  test("/cancelar con un renombrado pendiente → «Cancelado.» y el texto siguiente no renombra", async ({ request, api }) => {
    const { chat, ids: [id], names: [name] } = await linkedWith(request, api, "quieto");
    const { messageId } = await openList(request, chat);
    await startRename(request, chat, id, name, messageId);
    await expectReply(request, chat, "/cancelar", CANCELLED);
    await ask(request, chat, `${prefix()}-no`);
    expect(await nameOf(api, id)).toEqual([{ name }]);
  });

  for (const command of ["/hoy", "/habitos", "/ayuda", "/ejemplo", "/inventado"]) {
    test(`S-2: ${command} tras «✏️ Renombrar» cancela lo pendiente: el texto siguiente no renombra el hábito`, async ({ request, api }) => {
      const { chat, ids: [id], names: [name] } = await linkedWith(request, api, "s2");
      const { messageId } = await openList(request, chat);
      await startRename(request, chat, id, name, messageId);
      await ask(request, chat, command);
      const after = await ask(request, chat, `${prefix()}-pisado`);
      expect(plain(after.text), "no confirma un renombrado").not.toMatch(/^Hábito renombrado/);
      expect(await nameOf(api, id)).toEqual([{ name }]);
    });
  }

  test("S-2: /nuevo tras «✏️ Renombrar» sustituye lo pendiente: el texto siguiente es el nombre del hábito nuevo, no un renombrado", async ({ request, api }) => {
    const { chat, ids: [id], names: [name] } = await linkedWith(request, api, "sustituido");
    const { messageId } = await openList(request, chat);
    await startRename(request, chat, id, name, messageId);
    await expectReply(request, chat, "/nuevo", ASK_NAME);
    const fresh = `${prefix()}-fresco`;
    expectPalette(await ask(request, chat, fresh), fresh);
    expect(await nameOf(api, id)).toEqual([{ name }]);
  });

  test("S-2: /hoy tras /nuevo <nombre> cancela la paleta: tocar el color ya no crea nada", async ({ request, api }) => {
    const { chat } = await linkedWith(request, api, "hoy");
    const name = `${prefix()}-sin-crear`;
    const messageId = await startNew(request, chat, name);
    await ask(request, chat, "/hoy");
    await press(request, chat, "k:blue", messageId);
    await settle();
    expect(await named(api, name)).toEqual([]);
  });
});

test.describe("T28: /ejemplo, /ayuda, sin vínculo y la web", () => {
  test("/ejemplo con la cuenta vacía → «Datos de ejemplo cargados.» y los 3 hábitos; otra vez → «Ya tienes hábitos: …» sin duplicar", async ({ request, api }) => {
    await wipeAll(api);
    try {
      const chat = await linkChat(request, api);
      await expectReply(request, chat, "/ejemplo", SAMPLE_LOADED);
      expect((await botHabits(chat)).map((r) => r.name).sort()).toEqual(SAMPLE_NAMES);
      await expectReply(request, chat, "/ejemplo", SAMPLE_NOT_EMPTY);
      expect(await botHabits(chat)).toHaveLength(3);
    } finally {
      await wipeAll(api);
    }
  });

  test("/ejemplo con hábitos → «Ya tienes hábitos: …» y nada cambia", async ({ request, api }) => {
    const { chat } = await linkedWith(request, api, "tengo");
    const before = await snapshot(api);
    await expectReply(request, chat, "/ejemplo", SAMPLE_NOT_EMPTY);
    expect(await snapshot(api)).toBe(before);
  });

  test("/ayuda nombra todos los comandos (hoy, habitos, nuevo, ejemplo, cancelar, vincular, desvincular, ayuda); un texto libre sin nada pendiente → la misma ayuda", async ({ request, api }) => {
    const chat = await linkChat(request, api);
    const help = String((await ask(request, chat, "/ayuda")).text);
    for (const command of ALL_COMMANDS) expect(help, `la ayuda nombra ${command}`).toMatch(new RegExp(`${command}(?![a-z])`));
    expect((await ask(request, chat, `${prefix()}-texto libre`)).text).toBe(help);
  });

  test("sin vínculo: /nuevo <nombre>, /nuevo y /ejemplo → «Primero vincula tu cuenta…»; un color o r:<id> lo dicen en el callback; nada cambia", async ({ request, api }) => {
    const [id] = await seed(api, { name: `${prefix()}-ajeno` });
    const before = await snapshot(api);
    const stranger = fakeChat();
    for (const text of [`/nuevo ${prefix()}-intruso`, "/nuevo", "/ejemplo"]) {
      expect(buttons(await expectReply(request, stranger, text, LINK_FIRST))).toEqual([]);
    }
    expect([NOTHING_TO_CANCEL, LINK_FIRST]).toContain(plain((await ask(request, stranger, "/cancelar")).text));
    for (const data of ["k:red", `r:${id}`]) {
      const { answer } = await press(request, stranger, data, 1);
      expect(String(answer.text ?? "").trim(), `«${data.slice(0, 2)}» sin vínculo dice algo`).not.toBe("");
    }
    expect(await snapshot(api)).toBe(before);
  });

  test("en un grupo, /nuevo <nombre>, /nuevo, /ejemplo y /cancelar no crean nada y, si responde, es «Úsame en un chat privado.»", async ({ request, api }) => {
    await linkChat(request, api);
    const before = await snapshot(api);
    const group = -(1_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000));
    for (const text of [`/nuevo ${prefix()}-grupo`, "/nuevo", "/ejemplo", "/cancelar"]) {
      expect((await post(request, message(group, text, "group"))).status(), text).toBe(200);
    }
    await settle();
    const replies = calls.filter((c) => String(c.body.chat_id) === String(group)).map((c) => c.body.text);
    expect(replies.filter((t) => t !== PRIVATE_ONLY)).toEqual([]);
    expect(await snapshot(api)).toBe(before);
  });

  test("lo creado y lo renombrado en el bot se ve en la web al recargar", async ({ request, api, page }) => {
    const chat = await linkChat(request, api);
    const p = prefix();
    const name = `${p}-desde-el-bot`;
    await pickAndCreate(request, chat, "violet", await startNew(request, chat, name), name);
    await openApp(page);
    await expect(item(page, name), "la web ve el hábito creado en el bot").toBeVisible();

    const [{ id }] = await named(api, name);
    const { messageId } = await openList(request, chat);
    await startRename(request, chat, id, name, messageId);
    const next = `${p}-renombrado-en-el-bot`;
    await expectReply(request, chat, next, renamed(next));
    await page.reload();
    await expect(item(page, next), "la web ve el nombre nuevo").toBeVisible();
    await expect(item(page, name)).toHaveCount(0);
  });
});
