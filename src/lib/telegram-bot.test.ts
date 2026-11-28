import { describe, expect, it, vi } from "vitest";
import { type BotRpc, BotRpcError, type HabitRow, type TelegramApi, type TodayRow, handleUpdate } from "@/lib/telegram-bot";

const CHAT = 8_123_456_789_012_345;
const ID_A = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const ID_B = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

const LINKED = "¡Listo! Tu cuenta de Eslabón está vinculada. Si no has sido tú, envía /desvincular.";
const INVALID = "El código no es válido o ha caducado. Genera otro en la app.";
const HELLO = "Hola, soy el bot de Eslabón. Para empezar, vincula tu cuenta desde la app con «Vincular con Telegram».";
const NO_CODE = "Envía /vincular seguido del código que te da la app.";
const LINK_FIRST = "Primero vincula tu cuenta desde la app con «Vincular con Telegram».";
const NO_HABITS = "Aún no tienes hábitos. Créalos en la app.";
const GENERIC = "No se pudo completar. Inténtalo de nuevo.";
const GONE = "Ese hábito ya no existe.";
const OUT_OF_RANGE = "Solo puedes marcar días desde el 1 de enero de 2000 hasta hoy.";
const TODAY = "2026-11-27";

const habit = (habit_id: string, name: string, days: string[] = [], today = TODAY): HabitRow => ({
  habit_id,
  name,
  color: "teal",
  days,
  today,
});

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
      habits: vi.fn(rpc.habits ?? (async (): Promise<HabitRow[]> => [])),
      setDay: vi.fn(rpc.setDay ?? (async () => "ok")),
      deleteHabit: vi.fn(rpc.deleteHabit ?? (async () => "ok")),
      loadSample: vi.fn(rpc.loadSample ?? (async () => "ok")),
      startCreate: vi.fn(rpc.startCreate ?? (async () => "ok")),
      createHabit: vi.fn(rpc.createHabit ?? (async () => "ok")),
      startRename: vi.fn(rpc.startRename ?? (async () => "ok")),
      renameHabit: vi.fn(rpc.renameHabit ?? (async () => "ok")),
      pendingAction: vi.fn(rpc.pendingAction ?? (async (): Promise<string | null> => null)),
      cancel: vi.fn(rpc.cancel ?? (async () => {})),
    },
    telegram: vi.fn<TelegramApi>(async () => {}),
  };
  const sent = () => deps.telegram.mock.calls.map(([method, body]) => ({ method, body }));
  const rpcCalls = () => Object.values(deps.rpc).reduce((n, fn) => n + fn.mock.calls.length, 0);
  // The RPCs called, by name and in order (S-2: telegram_cancel comes first).
  const rpcOrder = () =>
    Object.entries(deps.rpc)
      .flatMap(([name, fn]) => fn.mock.invocationCallOrder.map((order) => [order, name] as const))
      .sort(([a], [b]) => a - b)
      .map(([, name]) => name);
  return { deps, sent, rpcCalls, rpcOrder };
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

  it("/start sin código → el saludo; solo cancela lo pendiente (S-2)", async () => {
    const { body, rpcOrder } = await reply("/start");
    expect(body.text).toBe(HELLO);
    expect(rpcOrder()).toEqual(["cancel"]);
  });

  it.each(["/vincular", "/vincular    "])("«%s» → cómo usarlo; solo cancela lo pendiente (S-2)", async (text) => {
    const { body, rpcOrder } = await reply(text);
    expect(body.text).toBe(NO_CODE);
    expect(rpcOrder()).toEqual(["cancel"]);
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

  it("/ayuda → la lista con todos los comandos; otro comando → la misma lista tras cancelar lo pendiente; un texto sin nada pendiente → la misma lista", async () => {
    const help = await reply("/ayuda");
    expect(help.rpcOrder()).toEqual(["cancel"]);
    for (const command of ["/hoy", "/habitos", "/nuevo", "/ejemplo", "/cancelar", "/vincular", "/desvincular", "/ayuda"]) {
      expect(String(help.body.text)).toMatch(new RegExp(`${command}(?![a-z])`));
    }
    const other = await reply("/inventado");
    expect(other.body.text).toBe(help.body.text);
    expect(other.rpcOrder()).toEqual(["cancel"]);
    for (const text of ["hola, ¿qué tal?", "hoy"]) {
      const free = await reply(text);
      expect(free.body.text).toBe(help.body.text);
      expect(free.rpcOrder()).toEqual(["pendingAction"]);
    }
  });
});

describe("handleUpdate: solo chats privados", () => {
  it.each(["group", "supergroup", "channel"])("un comando en «%s» → «Úsame en un chat privado.», sin RPC", async (type) => {
    for (const text of ["/start AB12CD34", "/hoy", "/habitos", "/ayuda"]) {
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

  it("un error que no es de una RPC sube tal cual, sin mensaje", async () => {
    const t = setup({ habits: async () => Promise.reject(new Error("bug")) });
    await expect(handleUpdate(message("/habitos"), t.deps)).rejects.toThrow("bug");
    expect(t.sent()).toEqual([]);
  });

  it.each(["/start AB12CD34", "/vincular AB12CD34", "/hoy", "/habitos", "/desvincular"])(
    "S-1: si una RPC falla en «%s» → el mensaje genérico, sin el error crudo",
    async (text) => {
      const fail = async () => Promise.reject(new BotRpcError());
      const { body } = await reply(text, { link: fail, unlink: fail, today: fail, habits: fail });
      expect(body).toEqual({ chat_id: CHAT, text: GENERIC });
    },
  );

  it.each([`c:${ID_A}:1`, `h:${ID_A}`, `m:${ID_A}:2026-11`, `d:${ID_A}:2026-11-03:1`, `x:${ID_A}`, `y:${ID_A}`, "l", "s"])(
    "S-1: si una RPC falla en el botón «%s» (p. ej. un 23503 al borrarse el hábito en medio) → el callback dice el genérico y no edita",
    async (data) => {
      const fail = async () => Promise.reject(new BotRpcError());
      const t = setup({ setCheckin: fail, habits: fail, setDay: fail, deleteHabit: fail, loadSample: fail });
      await handleUpdate(callback(data), t.deps);
      expect(t.sent()).toEqual([{ method: "answerCallbackQuery", body: { callback_query_id: "cb-1", text: GENERIC } }]);
    },
  );

  it("S-1: falla la RPC de después (releer los hábitos tras marcar) → el genérico y sin editar", async () => {
    const t = setup({ habits: async () => Promise.reject(new BotRpcError()) });
    await handleUpdate(callback(`d:${ID_A}:2026-11-03:1`), t.deps);
    expect(t.deps.rpc.setDay).toHaveBeenCalled();
    expect(t.sent()).toEqual([{ method: "answerCallbackQuery", body: { callback_query_id: "cb-1", text: GENERIC } }]);
  });
});

type Button = { text: string; callback_data: string };
const keyboardOf = (body: Record<string, unknown>) => (body.reply_markup as { inline_keyboard: Button[][] }).inline_keyboard;

// Presses a button and returns what the bot did: the answerCallbackQuery body and the edit, if any.
async function press(data: string, rpc: Partial<BotRpc> = {}) {
  const t = setup(rpc);
  await handleUpdate(callback(data), t.deps);
  const [answer, edit, ...rest] = t.sent();
  expect(answer.method).toBe("answerCallbackQuery");
  expect(rest).toEqual([]);
  if (edit) {
    expect(edit.method).toBe("editMessageText");
    expect(edit.body).toMatchObject({ chat_id: CHAT, message_id: 42 });
    expect("parse_mode" in edit.body).toBe(false);
  }
  return { answer: answer.body, edit: edit?.body, ...t };
}

const AGUA = habit(ID_A, "Agua", ["2026-11-25", "2026-11-26", "2026-11-27"]);
const LEER = habit(ID_B, "Leer");
const AGUA_STATS = "Agua\nRacha actual: 3 días\nMejor racha: 3 días\nÚltimos 30 días: 10 %";
const LEER_STATS = "Leer\nRacha actual: 0 días\nMejor racha: 0 días\nÚltimos 30 días: 0 %";
const LIST = {
  text: `Tus hábitos:\n\n${AGUA_STATS}\n\n${LEER_STATS}`,
  reply_markup: {
    inline_keyboard: [[{ text: "Agua", callback_data: `h:${ID_A}` }], [{ text: "Leer", callback_data: `h:${ID_B}` }]],
  },
};
const EMPTY_LIST = {
  text: "Aún no tienes hábitos. Crea el primero en la app o carga los datos de ejemplo.",
  reply_markup: { inline_keyboard: [[{ text: "Cargar datos de ejemplo", callback_data: "s" }]] },
};
const AGUA_MENU = {
  text: AGUA_STATS,
  reply_markup: {
    inline_keyboard: [
      [{ text: "📅 Historial", callback_data: `m:${ID_A}:2026-11` }],
      [
        { text: "✏️ Renombrar", callback_data: `r:${ID_A}` },
        { text: "🗑️ Borrar", callback_data: `x:${ID_A}` },
      ],
      [{ text: "⬅️ Volver", callback_data: "l" }],
    ],
  },
};
const both = async () => [AGUA, LEER];

describe("handleUpdate: /habitos", () => {
  it("sin vínculo → «Primero vincula…» y sin teclado", async () => {
    const { body } = await reply("/habitos", { status: async () => "not_linked" });
    expect(body).toEqual({ chat_id: CHAT, text: LINK_FIRST });
  });

  it("vinculado y sin hábitos → «Aún no tienes hábitos.…» y un solo botón «Cargar datos de ejemplo» (s)", async () => {
    const { body } = await reply("/habitos");
    expect(body).toEqual({ chat_id: CHAT, ...EMPTY_LIST });
  });

  it("con hábitos → «Tus hábitos:» y el nombre y las estadísticas de cada uno, y un botón <nombre> → h:<id> por hábito", async () => {
    const { body, deps } = await reply("/habitos", { habits: both });
    expect(deps.rpc.habits).toHaveBeenCalledWith(CHAT);
    expect(deps.rpc.status).not.toHaveBeenCalled();
    expect(body).toEqual({ chat_id: CHAT, ...LIST });
  });

  it("las estadísticas usan el today de la RPC y aguantan días duplicados y desordenados; «1 día» en singular", async () => {
    const days = ["2027-01-01", "2026-12-31", "2027-01-01", "2026-12-20"];
    const { body } = await reply("/habitos", { habits: async () => [habit(ID_A, "Año", days, "2027-01-01")] });
    expect(body.text).toBe("Tus hábitos:\n\nAño\nRacha actual: 2 días\nMejor racha: 2 días\nÚltimos 30 días: 10 %");
    const one = await reply("/habitos", { habits: async () => [habit(ID_A, "Uno", ["2028-02-29"], "2028-02-29")] });
    expect(one.body.text).toBe("Tus hábitos:\n\nUno\nRacha actual: 1 día\nMejor racha: 1 día\nÚltimos 30 días: 3 %");
  });

  it("un nombre con caracteres de formato llega literal y nunca hay parse_mode", async () => {
    const tricky = "<b>*_[x](y)`";
    const { body } = await reply("/habitos", { habits: async () => [habit(ID_A, tricky)] });
    expect(String(body.text).split("\n")[2]).toBe(tricky);
    expect(keyboardOf(body)).toEqual([[{ text: tricky, callback_data: `h:${ID_A}` }]]);
    expect("parse_mode" in body).toBe(false);
  });

  it("50 hábitos de 60 caracteres: el texto cabe en los 4096 de Telegram, dice cuántos faltan y hay 50 botones", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => habit(ID_A, `${String(i).padStart(2, "0")}${"x".repeat(58)}`));
    const { body } = await reply("/habitos", { habits: async () => rows });
    const text = String(body.text);
    expect(text.length).toBeLessThanOrEqual(4096);
    const shown = text.split("\n\n").length - 2;
    expect(shown).toBeGreaterThan(0);
    expect(text.endsWith(`\n\nY ${50 - shown} más: pulsa su botón para verlos.`)).toBe(true);
    expect(keyboardOf(body).flat()).toHaveLength(50);
  });

  it("regresión T27-r1 F-2: 50 nombres de 60 emoji fuera del BMP (120 unidades UTF-16 cada uno) → ≤ 4096 unidades UTF-16, «Y N más…» y 50 botones", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => habit(ID_A, "🔥".repeat(60), [], i % 2 ? TODAY : "2026-11-26"));
    const { body } = await reply("/habitos", { habits: async () => rows });
    const text = String(body.text);
    expect([..."🔥".repeat(60)]).toHaveLength(60);
    expect("🔥".repeat(60)).toHaveLength(120);
    expect(text.length).toBeLessThanOrEqual(4096);
    const shown = text.split("\n\n").length - 2;
    expect(shown).toBeGreaterThan(0);
    expect(text.endsWith(`\n\nY ${50 - shown} más: pulsa su botón para verlos.`)).toBe(true);
    expect(keyboardOf(body).flat()).toHaveLength(50);
  });
});

describe("handleUpdate: menú del hábito, lista y datos de ejemplo", () => {
  it("h:<id> → edita con el nombre, las estadísticas y «📅 Historial» (mes de hoy), «✏️ Renombrar», «🗑️ Borrar» y «⬅️ Volver»", async () => {
    const { answer, edit } = await press(`h:${ID_A}`, { habits: both });
    expect(answer).toEqual({ callback_query_id: "cb-1" });
    expect(edit).toEqual({ chat_id: CHAT, message_id: 42, ...AGUA_MENU });
  });

  it.each([
    ["un hábito que no está entre los del vínculo", [LEER], "linked", GONE],
    ["vinculado y sin hábitos", [], "linked", GONE],
    ["sin vínculo", [], "not_linked", LINK_FIRST],
  ])("h:<id> con %s → el callback lo dice y no edita", async (_, rows, linked, text) => {
    const { answer, edit } = await press(`h:${ID_A}`, { habits: async () => rows, status: async () => linked });
    expect(answer).toEqual({ callback_query_id: "cb-1", text });
    expect(edit).toBeUndefined();
  });

  it("l → edita con la lista; sin hábitos, con el estado vacío; sin vínculo, lo dice y no edita", async () => {
    expect((await press("l", { habits: both })).edit).toEqual({ chat_id: CHAT, message_id: 42, ...LIST });
    expect((await press("l")).edit).toEqual({ chat_id: CHAT, message_id: 42, ...EMPTY_LIST });
    const stranger = await press("l", { status: async () => "not_linked" });
    expect(stranger.answer).toEqual({ callback_query_id: "cb-1", text: LINK_FIRST });
    expect(stranger.edit).toBeUndefined();
  });

  it.each(["ok", "not_empty"])("s → telegram_load_sample (%s) y edita con la lista", async (result) => {
    const { edit, deps } = await press("s", { loadSample: async () => result, habits: both });
    expect(deps.rpc.loadSample).toHaveBeenCalledWith(CHAT);
    expect(edit).toEqual({ chat_id: CHAT, message_id: 42, ...LIST });
  });

  it("s sin vínculo → «Primero vincula…» y no edita", async () => {
    const { answer, edit, deps } = await press("s", { loadSample: async () => "not_linked" });
    expect(answer).toEqual({ callback_query_id: "cb-1", text: LINK_FIRST });
    expect(edit).toBeUndefined();
    expect(deps.rpc.habits).not.toHaveBeenCalled();
  });
});

describe("handleUpdate: calendario (m:)", () => {
  const n = (text: string) => ({ text, callback_data: "n" });
  // T27-r1 F-1: a marked day keeps its number next to «✅».
  const d = (day: string, done: boolean, text = `${done ? "✅" : ""}${Number(day.slice(8))}`) => ({
    text,
    callback_data: `d:${ID_A}:${day}:${done ? 0 : 1}`,
  });
  const nov = (date: number) => `2026-11-${String(date).padStart(2, "0")}`;
  const weekdays = ["L", "M", "X", "J", "V", "S", "D"].map(n);

  it("el mes de hoy: «‹» y el título, L M X J V S D, semanas de lunes a domingo con huecos, ✅ los marcados, hoy con su número, futuros inertes y «⬅️ Volver»", async () => {
    const row = habit(ID_A, "Agua", ["2026-11-01", "2026-11-10", "2026-11-26"]);
    const { answer, edit } = await press(`m:${ID_A}:2026-11`, { habits: async () => [row] });
    expect(answer).toEqual({ callback_query_id: "cb-1" });
    const gap = n("·");
    const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => d(nov(from + i), false));
    expect(edit).toEqual({
      chat_id: CHAT,
      message_id: 42,
      text: "Agua\nRacha actual: 1 día\nMejor racha: 1 día\nÚltimos 30 días: 10 %",
      reply_markup: {
        inline_keyboard: [
          [{ text: "‹", callback_data: `m:${ID_A}:2026-10` }, n("Noviembre de 2026")],
          weekdays,
          [gap, gap, gap, gap, gap, gap, d(nov(1), true)],
          days(2, 8),
          [d(nov(9), false), d(nov(10), true), ...days(11, 15)],
          days(16, 22),
          [...days(23, 25), d(nov(26), true), d(nov(27), false, "(27)"), n("28"), n("29")],
          [n("30"), gap, gap, gap, gap, gap, gap],
          [{ text: "⬅️ Volver", callback_data: `h:${ID_A}` }],
        ],
      },
    });
  });

  it("hoy marcado sale «✅27» y se desmarca con :0", async () => {
    const { edit } = await press(`m:${ID_A}:2026-11`, { habits: async () => [AGUA] });
    expect(keyboardOf(edit!)[6][4]).toEqual({ text: "✅27", callback_data: `d:${ID_A}:${TODAY}:0` });
  });

  it("regresión T27-r1 F-1: una semana entera marcada sigue diciendo qué día es cada botón", async () => {
    const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
    const { edit } = await press(`m:${ID_A}:2026-11`, { habits: async () => [habit(ID_A, "Agua", week)] });
    expect(keyboardOf(edit!)[5].map((b) => b.text)).toEqual(["✅16", "✅17", "✅18", "✅19", "✅20", "✅21", "✅22"]);
  });

  it("un mes anterior tiene «‹» y «›»; enero ↔ diciembre cambia de año; 2000-01 no tiene «‹»", async () => {
    const habits = async () => [habit(ID_A, "Agua", [], "2027-01-05")];
    expect(keyboardOf((await press(`m:${ID_A}:2026-12`, { habits })).edit!)[0]).toEqual([
      { text: "‹", callback_data: `m:${ID_A}:2026-11` },
      n("Diciembre de 2026"),
      { text: "›", callback_data: `m:${ID_A}:2027-01` },
    ]);
    expect(keyboardOf((await press(`m:${ID_A}:2027-01`, { habits })).edit!)[0]).toEqual([
      { text: "‹", callback_data: `m:${ID_A}:2026-12` },
      n("Enero de 2027"),
    ]);
    expect(keyboardOf((await press(`m:${ID_A}:2000-01`, { habits })).edit!)[0]).toEqual([
      n("Enero de 2000"),
      { text: "›", callback_data: `m:${ID_A}:2000-02` },
    ]);
  });

  it("febrero de 2027 empieza en lunes: 4 semanas sin huecos; febrero de 2028 tiene 29 días", async () => {
    const habits = async () => [habit(ID_A, "Agua", [], "2028-03-01")];
    const feb27 = keyboardOf((await press(`m:${ID_A}:2027-02`, { habits })).edit!);
    expect(feb27.slice(2, -1).map((w) => w.map((b) => b.text).join(" "))).toEqual([
      "1 2 3 4 5 6 7",
      "8 9 10 11 12 13 14",
      "15 16 17 18 19 20 21",
      "22 23 24 25 26 27 28",
    ]);
    const feb28 = keyboardOf((await press(`m:${ID_A}:2028-02`, { habits })).edit!);
    expect(feb28.flat().filter((b) => b.callback_data.startsWith("d:")).map((b) => b.text).at(-1)).toBe("29");
  });

  it("todos los botones caben en 64 bytes", async () => {
    const { edit } = await press(`m:${ID_A}:2026-11`, { habits: async () => [AGUA] });
    for (const b of keyboardOf(edit!).flat()) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });

  it.each(["2026-12", "1999-12"])("m:<id>:%s, fuera de 2000-01…mes de hoy → responde sin editar", async (month) => {
    const { answer, edit } = await press(`m:${ID_A}:${month}`, { habits: async () => [AGUA] });
    expect(answer).toEqual({ callback_query_id: "cb-1" });
    expect(edit).toBeUndefined();
  });

  it("m: de un hábito que no existe → «Ese hábito ya no existe.»", async () => {
    const { answer, edit } = await press(`m:${ID_B}:2026-11`, { habits: async () => [AGUA] });
    expect(answer).toEqual({ callback_query_id: "cb-1", text: GONE });
    expect(edit).toBeUndefined();
  });
});

describe("handleUpdate: marcar un día (d:)", () => {
  it.each([
    ["1", true, "Marcado"],
    ["0", false, "Desmarcado"],
  ])("d:<id>:<día>:%s → telegram_set_day, «%s» y edita con el calendario de ese mes", async (flag, done, text) => {
    const { answer, edit, deps } = await press(`d:${ID_A}:2026-10-31:${flag}`, { habits: async () => [AGUA] });
    expect(deps.rpc.setDay).toHaveBeenCalledWith(CHAT, ID_A, "2026-10-31", done);
    expect(answer).toEqual({ callback_query_id: "cb-1", text });
    expect(edit!.text).toBe(AGUA_STATS);
    expect(keyboardOf(edit!)[0].map((b) => b.text)).toContain("Octubre de 2026");
  });

  it.each([
    ["not_linked", LINK_FIRST],
    ["not_found", GONE],
    ["out_of_range", OUT_OF_RANGE],
    ["otra_cosa", GENERIC],
  ])("%s → el callback lo dice, no edita y no relee", async (result, text) => {
    const { answer, edit, deps } = await press(`d:${ID_A}:2026-11-28:1`, { setDay: async () => result });
    expect(answer).toEqual({ callback_query_id: "cb-1", text });
    expect(edit).toBeUndefined();
    expect(deps.rpc.habits).not.toHaveBeenCalled();
  });

  it("ok pero el hábito se borró justo después → «Ese hábito ya no existe.» y no edita", async () => {
    const { answer, edit } = await press(`d:${ID_A}:2026-11-27:1`, { habits: async () => [LEER] });
    expect(answer).toEqual({ callback_query_id: "cb-1", text: GONE });
    expect(edit).toBeUndefined();
  });
});

describe("handleUpdate: borrar (x: e y:)", () => {
  it("x:<id> → «¿Borrar «<nombre>» y todo su historial?» con «Sí, borrar» (y:<id>) y «Cancelar» (h:<id>), sin borrar", async () => {
    const { edit, deps } = await press(`x:${ID_A}`, { habits: both });
    expect(edit).toEqual({
      chat_id: CHAT,
      message_id: 42,
      text: "¿Borrar «Agua» y todo su historial?",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Sí, borrar", callback_data: `y:${ID_A}` },
            { text: "Cancelar", callback_data: `h:${ID_A}` },
          ],
        ],
      },
    });
    expect(deps.rpc.deleteHabit).not.toHaveBeenCalled();
  });

  it("y:<id> → telegram_delete_habit, «Borrado» y edita con la lista; con el último, con el estado vacío", async () => {
    const other = await press(`y:${ID_B}`, { habits: both });
    expect(other.deps.rpc.deleteHabit).toHaveBeenCalledWith(CHAT, ID_B);
    expect(other.answer).toEqual({ callback_query_id: "cb-1", text: "Borrado" });
    expect(other.edit).toEqual({ chat_id: CHAT, message_id: 42, ...LIST });
    expect((await press(`y:${ID_A}`)).edit).toEqual({ chat_id: CHAT, message_id: 42, ...EMPTY_LIST });
  });

  it.each([
    ["not_found", GONE],
    ["not_linked", LINK_FIRST],
  ])("y:<id> con %s → el callback lo dice y no edita", async (result, text) => {
    const { answer, edit } = await press(`y:${ID_A}`, { deleteHabit: async () => result });
    expect(answer).toEqual({ callback_query_id: "cb-1", text });
    expect(edit).toBeUndefined();
  });

  it("x: de un hábito que no existe → «Ese hábito ya no existe.»", async () => {
    const { answer, edit } = await press(`x:${ID_B}`, { habits: async () => [AGUA] });
    expect(answer).toEqual({ callback_query_id: "cb-1", text: GONE });
    expect(edit).toBeUndefined();
  });
});

describe("handleUpdate: botones inertes y mal formados", () => {
  it("«n» (título, L–D, huecos y futuros) → solo answerCallbackQuery, sin RPC", async () => {
    const data = "n";
    const { answer, edit, rpcCalls } = await press(data);
    expect(answer).toEqual({ callback_query_id: "cb-1" });
    expect(edit).toBeUndefined();
    expect(rpcCalls()).toBe(0);
  });

  it.each([
    "h:", "h:no-es-un-uuid", `h:${ID_A}x`, `h:${ID_A}:x`, `H:${ID_A}`, `m:${ID_A}`, `m:${ID_A}:2026-1`, `m:${ID_A}:2026-13`,
    `m:${ID_A}:2026-00`, `m:${ID_A}:2026-11:x`, `m:${ID_A}:2026-11-01`, `d:${ID_A}:2026-11-27`, `d:${ID_A}:2026-11-27:2`,
    `d:${ID_A}:2026-02-30:1`, `d:${ID_A}:20261127:1`, `d:no-es-un-uuid:2026-11-27:1`, `x:${ID_A}:x`, "x:", "y:", `y:${ID_A}x`,
    "l:x", "s:x", "n:x", `r:${ID_A}:x`, "r:", "r:no-es-un-uuid", "z", `h:${ID_A}${"x".repeat(64)}`,
    "k:pink", "k:", "k", "k:red:x", "K:red", "k:RED", `k:${"red".repeat(30)}`,
  ])("«%s» → ni RPC ni Telegram", async (data) => {
    const t = setup();
    await handleUpdate(callback(data), t.deps);
    expect(t.rpcCalls()).toBe(0);
    expect(t.sent()).toEqual([]);
  });

  it("un botón nuevo pulsado en un grupo → nada", async () => {
    const t = setup({ habits: both });
    await handleUpdate(callback(`h:${ID_A}`, "group"), t.deps);
    expect(t.sent()).toEqual([]);
    expect(t.rpcCalls()).toBe(0);
  });
});

const ASK_NAME = "Escribe el nombre del hábito nuevo.";
const EMPTY_NAME = "Escribe un nombre";
const TOO_LONG = "Máximo 60 caracteres";
const DUPLICATE = "Ya tienes un hábito con ese nombre.";
const LIMIT = "Has llegado al máximo de 50 hábitos.";
const PALETTE = [
  [
    { text: "🔴 Rojo", callback_data: "k:red" },
    { text: "🟠 Naranja", callback_data: "k:orange" },
    { text: "🟡 Ámbar", callback_data: "k:amber" },
  ],
  [
    { text: "🟢 Verde", callback_data: "k:green" },
    { text: "🔵 Azul", callback_data: "k:blue" },
    { text: "🟣 Violeta", callback_data: "k:violet" },
  ],
];
const palette = (name: string) => ({ chat_id: CHAT, text: `Elige un color para «${name}».`, reply_markup: { inline_keyboard: PALETTE } });

describe("handleUpdate: /nuevo", () => {
  it("/nuevo <nombre> → cancela lo pendiente (S-2), telegram_start_create con el nombre y la paleta de 6 colores", async () => {
    const { body, deps, rpcOrder } = await reply("/nuevo Leer");
    expect(rpcOrder()).toEqual(["cancel", "startCreate"]);
    expect(deps.rpc.startCreate).toHaveBeenCalledWith(CHAT, "Leer");
    expect(body).toEqual(palette("Leer"));
  });

  it("S-3: quita los espacios sobrantes del nombre antes de la RPC", async () => {
    const { body, deps } = await reply("/nuevo    Leer 20 minutos   ");
    expect(deps.rpc.startCreate).toHaveBeenCalledWith(CHAT, "Leer 20 minutos");
    expect(body.text).toBe("Elige un color para «Leer 20 minutos».");
  });

  it("60 caracteres valen; 61 → «Máximo 60 caracteres» sin RPC de crear y sin botones", async () => {
    expect((await reply(`/nuevo ${"a".repeat(60)}`)).body).toEqual(palette("a".repeat(60)));
    const { body, deps } = await reply(`/nuevo ${"a".repeat(61)}`);
    expect(body).toEqual({ chat_id: CHAT, text: TOO_LONG });
    expect(deps.rpc.startCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate", DUPLICATE],
    ["limit", LIMIT],
    ["not_linked", LINK_FIRST],
    ["invalid", GENERIC],
  ])("telegram_start_create → %s: «%s», sin botones", async (result, text) => {
    const { body } = await reply("/nuevo Leer", { startCreate: async () => result });
    expect(body).toEqual({ chat_id: CHAT, text });
  });

  it("/nuevo a secas → telegram_start_create sin nombre y «Escribe el nombre del hábito nuevo.»", async () => {
    const { body, deps, rpcOrder } = await reply("/nuevo");
    expect(rpcOrder()).toEqual(["cancel", "startCreate"]);
    expect(deps.rpc.startCreate).toHaveBeenCalledWith(CHAT, null);
    expect(body).toEqual({ chat_id: CHAT, text: ASK_NAME });
  });

  it.each([
    ["limit", LIMIT],
    ["not_linked", LINK_FIRST],
  ])("/nuevo a secas → %s: «%s»", async (result, text) => {
    expect((await reply("/nuevo", { startCreate: async () => result })).body.text).toBe(text);
  });

  it("con 'create' pendiente, el texto (trim) es el nombre: telegram_start_create, sin cancelar, y la paleta", async () => {
    const { body, deps, rpcOrder } = await reply("   Caminar   ", { pendingAction: async () => "create" });
    expect(rpcOrder()).toEqual(["pendingAction", "startCreate"]);
    expect(deps.rpc.startCreate).toHaveBeenCalledWith(CHAT, "Caminar");
    expect(body).toEqual(palette("Caminar"));
  });

  it.each([
    ["   ", EMPTY_NAME],
    ["a".repeat(61), TOO_LONG],
  ])("con 'create' pendiente, «%s» → el mensaje de la web, sin RPC de crear ni cancelar (sigue esperando)", async (text, error) => {
    const { body, rpcOrder } = await reply(text, { pendingAction: async () => "create" });
    expect(body).toEqual({ chat_id: CHAT, text: error });
    expect(rpcOrder()).toEqual(["pendingAction"]);
  });

  it("con 'create' pendiente, un duplicado → «Ya tienes un hábito con ese nombre.»", async () => {
    const { body } = await reply("LEER", { pendingAction: async () => "create", startCreate: async () => "duplicate" });
    expect(body.text).toBe(DUPLICATE);
  });

  it("caducado (telegram_pending_action → null): el texto es la ayuda, no un nombre", async () => {
    const help = (await reply("/ayuda")).body.text;
    const { body, deps } = await reply("Caminar", { pendingAction: async () => null });
    expect(body.text).toBe(help);
    expect(deps.rpc.startCreate).not.toHaveBeenCalled();
    expect(deps.rpc.renameHabit).not.toHaveBeenCalled();
  });
});

describe("handleUpdate: elegir el color (k:)", () => {
  it.each(["red", "orange", "amber", "green", "blue", "violet"])(
    "k:%s → telegram_create_habit con el color y edita con «Hábito «<nombre>» creado.» (el más nuevo), sin botones",
    async (color) => {
      const { deps, answer, edit } = await press(`k:${color}`, { habits: async () => [LEER, habit(ID_A, "Caminar")] });
      expect(deps.rpc.createHabit).toHaveBeenCalledWith(CHAT, color);
      expect(answer).toEqual({ callback_query_id: "cb-1" });
      expect(edit).toEqual({ chat_id: CHAT, message_id: 42, text: "Hábito «Caminar» creado." });
    },
  );

  it.each([
    ["duplicate", DUPLICATE],
    ["limit", LIMIT],
    ["not_linked", LINK_FIRST],
    ["invalid", GENERIC],
  ])("telegram_create_habit → %s: «%s» en el callback y no edita", async (result, text) => {
    const { answer, edit } = await press("k:blue", { createHabit: async () => result });
    expect(answer).toEqual({ callback_query_id: "cb-1", text });
    expect(edit).toBeUndefined();
  });

  it("sin nada pendiente (no_pending, también el segundo de un doble toque) → lo dice en el callback y no edita", async () => {
    const { answer, edit } = await press("k:blue", { createHabit: async () => "no_pending" });
    expect(answer).toEqual({ callback_query_id: "cb-1", text: "No hay ningún hábito por crear. Envía /nuevo." });
    expect(edit).toBeUndefined();
  });

  it("los botones de la paleta caben en 64 bytes", async () => {
    for (const b of PALETTE.flat()) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
});

describe("handleUpdate: renombrar (r:)", () => {
  it("r:<id> → telegram_start_rename y edita con «Escribe el nuevo nombre de «<nombre>».», sin botones", async () => {
    const { deps, answer, edit } = await press(`r:${ID_A}`, { habits: both });
    expect(deps.rpc.startRename).toHaveBeenCalledWith(CHAT, ID_A);
    expect(answer).toEqual({ callback_query_id: "cb-1" });
    expect(edit).toEqual({ chat_id: CHAT, message_id: 42, text: "Escribe el nuevo nombre de «Agua»." });
  });

  it.each([
    ["not_found", GONE],
    ["not_linked", LINK_FIRST],
  ])("telegram_start_rename → %s: «%s» en el callback y no edita", async (result, text) => {
    const { answer, edit } = await press(`r:${ID_A}`, { startRename: async () => result });
    expect(answer).toEqual({ callback_query_id: "cb-1", text });
    expect(edit).toBeUndefined();
  });

  it("ok pero el hábito se borró justo después → «Ese hábito ya no existe.»", async () => {
    const { answer, edit } = await press(`r:${ID_A}`, { habits: async () => [LEER] });
    expect(answer).toEqual({ callback_query_id: "cb-1", text: GONE });
    expect(edit).toBeUndefined();
  });

  it("con 'rename' pendiente, el texto (trim) es el nombre nuevo: telegram_rename_habit, sin cancelar, «Hábito renombrado a «<nuevo>».»", async () => {
    const { body, deps, rpcOrder } = await reply("  Leer más  ", { pendingAction: async () => "rename" });
    expect(rpcOrder()).toEqual(["pendingAction", "renameHabit"]);
    expect(deps.rpc.renameHabit).toHaveBeenCalledWith(CHAT, "Leer más");
    expect(body).toEqual({ chat_id: CHAT, text: "Hábito renombrado a «Leer más»." });
  });

  it.each([
    ["   ", EMPTY_NAME],
    ["a".repeat(61), TOO_LONG],
  ])("con 'rename' pendiente, «%s» → el mensaje de la web, sin RPC de renombrar (sigue esperando)", async (text, error) => {
    const { body, rpcOrder } = await reply(text, { pendingAction: async () => "rename" });
    expect(body).toEqual({ chat_id: CHAT, text: error });
    expect(rpcOrder()).toEqual(["pendingAction"]);
  });

  it.each([
    ["duplicate", DUPLICATE],
    ["not_found", GONE],
    ["not_linked", LINK_FIRST],
    ["invalid", GENERIC],
  ])("telegram_rename_habit → %s: «%s»", async (result, text) => {
    const { body } = await reply("Leer más", { pendingAction: async () => "rename", renameHabit: async () => result });
    expect(body).toEqual({ chat_id: CHAT, text });
  });

  it("no_pending (caducó entre medias) → la ayuda", async () => {
    const help = (await reply("/ayuda")).body.text;
    const { body } = await reply("Leer más", { pendingAction: async () => "rename", renameHabit: async () => "no_pending" });
    expect(body.text).toBe(help);
  });
});

describe("handleUpdate: /ejemplo y /cancelar", () => {
  it.each([
    ["ok", "Datos de ejemplo cargados."],
    ["not_empty", "Ya tienes hábitos: los datos de ejemplo solo se cargan en una cuenta vacía."],
    ["not_linked", LINK_FIRST],
  ])("/ejemplo → cancela (S-2) y telegram_load_sample → %s: «%s»", async (result, text) => {
    const { body, rpcOrder } = await reply("/ejemplo", { loadSample: async () => result });
    expect(rpcOrder()).toEqual(["cancel", "loadSample"]);
    expect(body).toEqual({ chat_id: CHAT, text });
  });

  it.each([
    ["create", "Cancelado."],
    ["rename", "Cancelado."],
    [null, "No había nada que cancelar."],
  ])("/cancelar con %s pendiente → mira lo pendiente, lo borra y «%s»", async (pending, text) => {
    const { body, rpcOrder } = await reply("/cancelar", { pendingAction: async () => pending });
    expect(rpcOrder()).toEqual(["pendingAction", "cancel"]);
    expect(body).toEqual({ chat_id: CHAT, text });
  });
});

describe("handleUpdate: S-2 (cualquier comando cancela lo pendiente antes de ejecutarse)", () => {
  it.each(["/start AB12CD34", "/vincular AB12CD34", "/hoy", "/habitos", "/desvincular", "/ayuda", "/inventado", "/nuevo", "/nuevo Leer", "/ejemplo"])(
    "«%s» → telegram_cancel es la primera RPC y nunca se llama a telegram_pending_action ni se renombra",
    async (text) => {
      const { rpcOrder, deps } = await reply(text, { pendingAction: async () => "rename" });
      expect(rpcOrder()[0]).toBe("cancel");
      expect(deps.rpc.pendingAction).not.toHaveBeenCalled();
      expect(deps.rpc.renameHabit).not.toHaveBeenCalled();
    },
  );

  it("si telegram_cancel falla, el comando no se ejecuta: el genérico", async () => {
    const { body, deps } = await reply("/nuevo Leer", { cancel: async () => Promise.reject(new BotRpcError()) });
    expect(body).toEqual({ chat_id: CHAT, text: GENERIC });
    expect(deps.rpc.startCreate).not.toHaveBeenCalled();
  });

  it("en un grupo, /nuevo, /ejemplo y /cancelar → «Úsame en un chat privado.», sin RPC", async () => {
    for (const text of ["/nuevo Leer", "/nuevo", "/ejemplo", "/cancelar"]) {
      const t = setup();
      await handleUpdate(message(text, "group", -100), t.deps);
      expect(t.rpcCalls()).toBe(0);
      expect(t.sent()).toEqual([{ method: "sendMessage", body: { chat_id: -100, text: "Úsame en un chat privado." } }]);
    }
  });
});

describe("handleUpdate: S-1 en T28", () => {
  const fail = async () => Promise.reject(new BotRpcError());

  it.each(["/nuevo Leer", "/nuevo", "/ejemplo", "/cancelar", "Leer"])("una RPC falla en «%s» → el genérico", async (text) => {
    const { body } = await reply(text, { startCreate: fail, loadSample: fail, pendingAction: fail });
    expect(body).toEqual({ chat_id: CHAT, text: GENERIC });
  });

  it.each([
    ["create", { startCreate: fail }],
    ["rename", { renameHabit: fail }],
  ] as const)("con '%s' pendiente, falla la RPC del nombre → el genérico", async (pending, rpc) => {
    const { body } = await reply("Leer", { pendingAction: async () => pending, ...rpc });
    expect(body).toEqual({ chat_id: CHAT, text: GENERIC });
  });

  it.each(["k:red", `r:${ID_A}`])("una RPC falla en el botón «%s» → el callback dice el genérico y no edita", async (data) => {
    const t = setup({ createHabit: fail, startRename: fail, habits: fail });
    await handleUpdate(callback(data), t.deps);
    expect(t.sent()).toEqual([{ method: "answerCallbackQuery", body: { callback_query_id: "cb-1", text: GENERIC } }]);
  });
});
