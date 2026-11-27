import { describe, expect, it, vi } from "vitest";
import { type BotRpc, type TelegramApi, type TodayRow, handleUpdate } from "@/lib/telegram-bot";

const CHAT = 8_123_456_789_012_345;
const ID_A = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const ID_B = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

const LINKED = "¡Listo! Tu cuenta de Eslabón está vinculada. Si no has sido tú, envía /desvincular.";
const INVALID = "El código no es válido o ha caducado. Genera otro en la app.";
const HELLO = "Hola, soy el bot de Eslabón. Para empezar, vincula tu cuenta desde la app con «Vincular con Telegram».";
const NO_CODE = "Envía /vincular seguido del código que te da la app.";
const LINK_FIRST = "Primero vincula tu cuenta desde la app con «Vincular con Telegram».";
const NO_HABITS = "Aún no tienes hábitos. Créalos en la app.";

const row = (habit_id: string, name: string, done: boolean, today = "2026-11-27"): TodayRow => ({
  habit_id,
  name,
  color: "teal",
  done,
  today,
});

// In-memory doubles: every RPC and every call to the Telegram API is recorded, nothing touches the network.
function setup(rpc: Partial<BotRpc> = {}) {
  const deps = {
    rpc: {
      link: vi.fn(rpc.link ?? (async () => "linked")),
      unlink: vi.fn(rpc.unlink ?? (async () => "unlinked")),
      status: vi.fn(rpc.status ?? (async () => "linked")),
      today: vi.fn(rpc.today ?? (async (): Promise<TodayRow[]> => [])),
      setCheckin: vi.fn(rpc.setCheckin ?? (async () => "ok")),
    },
    telegram: vi.fn<TelegramApi>(async () => {}),
  };
  const sent = () => deps.telegram.mock.calls.map(([method, body]) => ({ method, body }));
  const rpcCalls = () => Object.values(deps.rpc).reduce((n, fn) => n + fn.mock.calls.length, 0);
  return { deps, sent, rpcCalls };
}

function message(text: string | undefined, type = "private", chat = CHAT) {
  return { update_id: 1, message: { message_id: 7, chat: { id: chat, type }, text } };
}

function callback(data: string | undefined, type = "private") {
  return {
    update_id: 2,
    callback_query: { id: "cb-1", data, message: { message_id: 42, chat: { id: CHAT, type } } },
  };
}

async function reply(text: string, rpc: Partial<BotRpc> = {}) {
  const t = setup(rpc);
  await handleUpdate(message(text), t.deps);
  expect(t.sent()).toHaveLength(1);
  const [{ method, body }] = t.sent();
  expect(method).toBe("sendMessage");
  expect(body.chat_id).toBe(CHAT);
  return { body, ...t };
}

describe("handleUpdate: updates que no se entienden", () => {
  it.each([
    ["null", null],
    ["texto", "x"],
    ["objeto vacío", {}],
    ["array", []],
    ["message que no es un objeto", { update_id: 4, message: "x" }],
    ["message sin texto", { update_id: 3, message: { chat: { id: CHAT, type: "private" } } }],
    ["edited_message", { update_id: 5, edited_message: message("/hoy").message }],
    ["my_chat_member", { update_id: 6, my_chat_member: { chat: { id: CHAT } } }],
    ["chat con id que no es un número", message("/hoy", "private", "1" as unknown as number)],
    ["callback sin data ni mensaje", { update_id: 7, callback_query: { id: "x" } }],
    ["callback sin mensaje", { update_id: 8, callback_query: { id: "x", data: `c:${ID_A}:1` } }],
  ])("%s → ni RPC ni Telegram", async (_, update) => {
    const t = setup();
    await handleUpdate(update, t.deps);
    expect(t.sent()).toEqual([]);
    expect(t.rpcCalls()).toBe(0);
  });
});

describe("handleUpdate: vincular", () => {
  it("/start <código> → telegram_link con el chat y «¡Listo!…»", async () => {
    const { body, deps } = await reply("/start AB12CD34");
    expect(deps.rpc.link).toHaveBeenCalledWith("AB12CD34", CHAT);
    expect(body.text).toBe(LINKED);
  });

  it("/vincular normaliza el código: mayúsculas y sin espacios", async () => {
    const { body, deps } = await reply("/vincular   ab1 2cD  34 ");
    expect(deps.rpc.link).toHaveBeenCalledWith("AB12CD34", CHAT);
    expect(body.text).toBe(LINKED);
  });

  it("acepta el comando con la mención del bot (/start@EslabonHabitsBot)", async () => {
    const { deps } = await reply("/start@EslabonHabitsBot AB12CD34");
    expect(deps.rpc.link).toHaveBeenCalledWith("AB12CD34", CHAT);
  });

  it("invalid_code → «El código no es válido…», con /start y con /vincular", async () => {
    const invalid = { link: async () => "invalid_code" };
    expect((await reply("/start ZZZZZZZZ", invalid)).body.text).toBe(INVALID);
    expect((await reply("/vincular 00000000", invalid)).body.text).toBe(INVALID);
  });

  it("/start sin código → el saludo, sin RPC", async () => {
    const { body, rpcCalls } = await reply("/start");
    expect(body.text).toBe(HELLO);
    expect(rpcCalls()).toBe(0);
  });

  it.each(["/vincular", "/vincular    "])("«%s» → cómo usarlo, sin RPC", async (text) => {
    const { body, rpcCalls } = await reply(text);
    expect(body.text).toBe(NO_CODE);
    expect(rpcCalls()).toBe(0);
  });
});

describe("handleUpdate: /hoy", () => {
  it("sin vínculo → «Primero vincula…» y sin teclado", async () => {
    const { body } = await reply("/hoy", { status: async () => "not_linked" });
    expect(body.text).toBe(LINK_FIRST);
    expect(body.reply_markup).toBeUndefined();
  });

  it("vinculado y sin hábitos → «Aún no tienes hábitos…» y sin teclado", async () => {
    const { body } = await reply("/hoy");
    expect(body.text).toBe(NO_HABITS);
    expect(body.reply_markup).toBeUndefined();
  });

  it("con hábitos → la cabecera con la fecha larga y un botón por fila, ✅ c:<id>:0 o ⬜ c:<id>:1", async () => {
    const today = async () => [row(ID_A, "Agua", false), row(ID_B, "Leer", true)];
    const { body, deps } = await reply("/hoy", { today });
    expect(deps.rpc.today).toHaveBeenCalledWith(CHAT);
    expect(body.text).toBe("Tus hábitos de hoy (27 de noviembre de 2026):");
    expect(body.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: "⬜ Agua", callback_data: `c:${ID_A}:1` }],
        [{ text: "✅ Leer", callback_data: `c:${ID_B}:0` }],
      ],
    });
  });

  it("callback_data cabe en los 64 bytes de Telegram", async () => {
    const { body } = await reply("/hoy", { today: async () => [row(ID_A, "Agua", true)] });
    const [[button]] = (body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard;
    expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
  });

  it.each([
    ["2026-12-31", "31 de diciembre de 2026"],
    ["2027-01-01", "1 de enero de 2027"],
    ["2028-02-29", "29 de febrero de 2028"],
    ["2026-02-28", "28 de febrero de 2026"],
    ["2026-03-29", "29 de marzo de 2026"],
    ["2026-10-25", "25 de octubre de 2026"],
  ])("el today %s de la RPC se escribe «%s», sin moverse de día", async (day, long) => {
    const { body } = await reply("/hoy", { today: async () => [row(ID_A, "Agua", false, day)] });
    expect(body.text).toBe(`Tus hábitos de hoy (${long}):`);
  });

  it("un nombre con caracteres de formato llega literal y nunca hay parse_mode", async () => {
    const tricky = "<b>*_[x](y)`";
    const { body } = await reply("/hoy", { today: async () => [row(ID_A, tricky, false)] });
    expect(body.reply_markup).toEqual({ inline_keyboard: [[{ text: `⬜ ${tricky}`, callback_data: `c:${ID_A}:1` }]] });
    expect("parse_mode" in body).toBe(false);
  });
});

describe("handleUpdate: /desvincular y /ayuda", () => {
  it("/desvincular vinculado → «Tu cuenta se ha desvinculado.»", async () => {
    const { body, deps } = await reply("/desvincular");
    expect(deps.rpc.unlink).toHaveBeenCalledWith(CHAT);
    expect(body.text).toBe("Tu cuenta se ha desvinculado.");
  });

  it("/desvincular sin vínculo → «No había ninguna cuenta vinculada.»", async () => {
    const { body } = await reply("/desvincular", { unlink: async () => "not_linked" });
    expect(body.text).toBe("No había ninguna cuenta vinculada.");
  });

  it("/ayuda → la lista de comandos, y cualquier otro texto o comando → la misma lista, sin RPC", async () => {
    const help = await reply("/ayuda");
    for (const command of ["/hoy", "/vincular", "/desvincular", "/ayuda"]) expect(help.body.text).toContain(command);
    for (const text of ["hola, ¿qué tal?", "/inventado", "hoy"]) {
      const other = await reply(text);
      expect(other.body.text).toBe(help.body.text);
      expect(other.rpcCalls()).toBe(0);
    }
  });
});

describe("handleUpdate: solo chats privados", () => {
  it.each(["group", "supergroup", "channel"])("un comando en «%s» → «Úsame en un chat privado.», sin RPC", async (type) => {
    for (const text of ["/start AB12CD34", "/hoy", "/ayuda"]) {
      const t = setup();
      await handleUpdate(message(text, type, -1_001_234_567_890), t.deps);
      expect(t.rpcCalls()).toBe(0);
      expect(t.sent()).toEqual([
        { method: "sendMessage", body: { chat_id: -1_001_234_567_890, text: "Úsame en un chat privado." } },
      ]);
    }
  });

  it("un texto que no es un comando en un grupo → nada", async () => {
    const t = setup();
    await handleUpdate(message("hola a todos", "group", -100), t.deps);
    expect(t.sent()).toEqual([]);
  });

  it("un botón pulsado fuera de un chat privado → nada", async () => {
    const t = setup();
    await handleUpdate(callback(`c:${ID_A}:1`, "group"), t.deps);
    expect(t.sent()).toEqual([]);
    expect(t.rpcCalls()).toBe(0);
  });
});

describe("handleUpdate: botones (callback_query)", () => {
  it("c:<id>:1 → marca, «Marcado» y edita el mensaje con el teclado actualizado", async () => {
    const t = setup({ today: async () => [row(ID_A, "Agua", true), row(ID_B, "Leer", false)] });
    await handleUpdate(callback(`c:${ID_A}:1`), t.deps);
    expect(t.deps.rpc.setCheckin).toHaveBeenCalledWith(CHAT, ID_A, true);
    expect(t.sent()).toEqual([
      { method: "answerCallbackQuery", body: { callback_query_id: "cb-1", text: "Marcado" } },
      {
        method: "editMessageText",
        body: {
          chat_id: CHAT,
          message_id: 42,
          text: "Tus hábitos de hoy (27 de noviembre de 2026):",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Agua", callback_data: `c:${ID_A}:0` }],
              [{ text: "⬜ Leer", callback_data: `c:${ID_B}:1` }],
            ],
          },
        },
      },
    ]);
  });

  it("c:<id>:0 → desmarca y «Desmarcado»", async () => {
    const t = setup({ today: async () => [row(ID_A, "Agua", false)] });
    await handleUpdate(callback(`c:${ID_A}:0`), t.deps);
    expect(t.deps.rpc.setCheckin).toHaveBeenCalledWith(CHAT, ID_A, false);
    expect(t.sent()[0]).toEqual({ method: "answerCallbackQuery", body: { callback_query_id: "cb-1", text: "Desmarcado" } });
    expect(t.sent()[1].method).toBe("editMessageText");
  });

  it.each([
    ["not_linked", LINK_FIRST],
    ["not_found", "Ese hábito ya no existe."],
  ])("%s → el callback lo dice y no edita", async (result, text) => {
    const t = setup({ setCheckin: async () => result });
    await handleUpdate(callback(`c:${ID_A}:1`), t.deps);
    expect(t.sent()).toEqual([{ method: "answerCallbackQuery", body: { callback_query_id: "cb-1", text } }]);
    expect(t.deps.rpc.today).not.toHaveBeenCalled();
  });

  it.each(["", "x", "c:", `c:${ID_A}`, `c:${ID_A}:2`, `c:${ID_A}:1:extra`, "c:no-es-un-uuid:1", `d:${ID_A}:1`, `C:${ID_A}:1`])(
    "callback_data mal formado «%s» → ni RPC ni Telegram",
    async (data) => {
      const t = setup();
      await handleUpdate(callback(data), t.deps);
      expect(t.rpcCalls()).toBe(0);
      expect(t.sent()).toEqual([]);
    },
  );
});

describe("handleUpdate: errores", () => {
  it("si la API de Telegram falla, el error sube (la route lo recoge y responde 200)", async () => {
    const t = setup();
    t.deps.telegram.mockRejectedValueOnce(new Error("Telegram 500"));
    await expect(handleUpdate(message("/ayuda"), t.deps)).rejects.toThrow("Telegram 500");
  });

  it("si una RPC falla, el error sube y no se envía nada", async () => {
    const t = setup({ link: async () => Promise.reject(new Error("rpc")) });
    await expect(handleUpdate(message("/start AB12CD34"), t.deps)).rejects.toThrow("rpc");
    expect(t.sent()).toEqual([]);
  });
});
