import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/auth";
import {
  type Day,
  EARLIEST_MONTH,
  addMonths,
  isValidDay,
  longDateIn,
  monthTitle,
  monthWeeks,
  shownMonth,
  WEEKDAY_LETTERS,
} from "@/lib/dates";
import { COLOR_IDS, DUPLICATE_HABIT, HABIT_COLORS, HABIT_GONE, HABIT_LIMIT, HabitName, OUT_OF_RANGE } from "@/lib/habits";
import { habitStats } from "@/lib/streak";

// The bot's RPCs (supabase/migrations/*_telegram*.sql), already bound to the bot secret.
export type TodayRow = { habit_id: string; name: string; color: string; done: boolean; today: string };
export type HabitRow = { habit_id: string; name: string; color: string; days: Day[]; today: Day };
export type BotRpc = {
  link(code: string, chatId: number): Promise<string>;
  unlink(chatId: number): Promise<string>;
  status(chatId: number): Promise<string>;
  today(chatId: number): Promise<TodayRow[]>;
  setCheckin(chatId: number, habitId: string, done: boolean): Promise<string>;
  habits(chatId: number): Promise<HabitRow[]>;
  setDay(chatId: number, habitId: string, day: Day, done: boolean): Promise<string>;
  deleteHabit(chatId: number, habitId: string): Promise<string>;
  loadSample(chatId: number): Promise<string>;
  startCreate(chatId: number, name: string | null): Promise<string>;
  createHabit(chatId: number, color: string): Promise<string>;
  startRename(chatId: number, habitId: string): Promise<string>;
  renameHabit(chatId: number, name: string): Promise<string>;
  // 'create' or 'rename' while the chat waits for a name (or a color), null otherwise (also when it expired).
  pendingAction(chatId: number): Promise<string | null>;
  cancel(chatId: number): Promise<void>;
};
// What a BotRpc throws when the RPC fails: the user gets the generic message, never the raw error.
export class BotRpcError extends Error {}
// POST to a Bot API method; rejects if Telegram does not accept it.
export type TelegramApi = (method: string, body: Record<string, unknown>) => Promise<void>;

type Button = { text: string; callback_data: string };
type View = { text: string; reply_markup?: { inline_keyboard: Button[][] } };
// What a pressed button does: the text of its answerCallbackQuery (none: just stop the spinner) and the new message.
type Outcome = { answer?: string; view?: View };

const HELLO = "Hola, soy el bot de Eslabón. Para empezar, vincula tu cuenta desde la app con «Vincular con Telegram».";
const LINK_FIRST = "Primero vincula tu cuenta desde la app con «Vincular con Telegram».";
const HELP = [
  "Esto es lo que puedo hacer:",
  "/hoy: tus hábitos de hoy, para marcarlos o desmarcarlos",
  "/habitos: tus hábitos con sus estadísticas y su historial, para marcar días, renombrarlos o borrarlos",
  "/nuevo <nombre>: crea un hábito",
  "/ejemplo: carga los datos de ejemplo si aún no tienes hábitos",
  "/cancelar: cancela lo que estés haciendo (crear o renombrar un hábito)",
  "/vincular <código>: vincula tu cuenta de Eslabón con el código de la app",
  "/desvincular: desvincula tu cuenta",
  "/ayuda: esta lista",
].join("\n");
const EMPTY_LIST = "Aún no tienes hábitos. Crea el primero en la app o carga los datos de ejemplo.";
const ASK_NAME = "Escribe el nombre del hábito nuevo.";
const NO_PENDING_COLOR = "No hay ningún hábito por crear. Envía /nuevo.";
// The palette's buttons, in the web's order.
const COLOR_EMOJI = { red: "🔴", orange: "🟠", amber: "🟡", green: "🟢", blue: "🔵", violet: "🟣" } satisfies Record<
  (typeof COLOR_IDS)[number],
  string
>;
// Telegram's limit for a message text.
const MAX_TEXT = 4096;
// callback_data of the buttons that do nothing: the month title, L–D, the gaps and the future days.
const NOOP = "n";

// Only the fields the bot reads. Anything else (edited_message, my_chat_member…) does not match and is ignored.
const Chat = z.object({ id: z.int(), type: z.string() });
const Update = z.object({
  message: z.object({ chat: Chat, text: z.string() }).optional(),
  callback_query: z
    .object({ id: z.string(), data: z.string(), message: z.object({ message_id: z.int(), chat: Chat }) })
    .optional(),
});
// The callback_data the bot builds, split on «:». Anything else is ignored. 1 = mark, 0 = unmark.
const Id = z.uuid();
const Flag = z.enum(["0", "1"]);
const CallbackData = z.union([
  z.tuple([z.literal("c"), Id, Flag]),
  z.tuple([z.literal("h"), Id]),
  z.tuple([z.literal("x"), Id]),
  z.tuple([z.literal("k"), z.enum(COLOR_IDS)]),
  z.tuple([z.enum(["r", "y"]), Id]),
  z.tuple([z.literal("m"), Id, z.string().refine((month) => isValidDay(`${month}-01`))]),
  z.tuple([z.literal("d"), Id, z.string().refine(isValidDay), Flag]),
  z.tuple([z.enum(["l", "s", NOOP])]),
]);
type Callback = z.infer<typeof CallbackData>;
const COMMAND = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i;

// Plain text on purpose (never parse_mode): habit names are written by users and must not be read as formatting.
export async function handleUpdate(update: unknown, deps: { rpc: BotRpc; telegram: TelegramApi }): Promise<void> {
  const parsed = Update.safeParse(update);
  if (!parsed.success) return;
  const { message, callback_query: query } = parsed.data;
  const { rpc, telegram } = deps;

  if (query) {
    if (query.message.chat.type !== "private") return;
    const data = CallbackData.safeParse(query.data.split(":"));
    if (!data.success) return;
    const chatId = query.message.chat.id;
    const { answer, view } = await orGeneric(onCallback(data.data, chatId, rpc), { answer: GENERIC_ERROR });
    await telegram("answerCallbackQuery", { callback_query_id: query.id, ...(answer && { text: answer }) });
    if (view) await telegram("editMessageText", { chat_id: chatId, message_id: query.message.message_id, ...view });
    return;
  }

  if (!message) return;
  const chatId = message.chat.id;
  const command = COMMAND.exec(message.text.trim());

  if (message.chat.type !== "private") {
    if (command) await telegram("sendMessage", { chat_id: chatId, text: "Úsame en un chat privado." });
    return;
  }

  const work = command ? onCommand(command[1].toLowerCase(), command[2] ?? "", chatId, rpc) : onText(message.text, chatId, rpc);
  const view = await orGeneric(work, { text: GENERIC_ERROR });
  await telegram("sendMessage", { chat_id: chatId, ...view });
}

// S-1: a failed RPC (a raw DB error, a 23503 if the habit is deleted meanwhile…) becomes the generic message.
async function orGeneric<T>(work: Promise<T>, generic: T): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof BotRpcError) return generic;
    throw error;
  }
}

async function onCommand(name: string, arg: string, chatId: number, rpc: BotRpc): Promise<View> {
  if (name === "cancelar") {
    const pending = await rpc.pendingAction(chatId);
    await rpc.cancel(chatId);
    return { text: pending ? "Cancelado." : "No había nada que cancelar." };
  }

  // S-2: every command ends what was pending first (if that fails, the command does not run), so a later text cannot
  // rename a habit from an earlier action. /nuevo then starts its own.
  await rpc.cancel(chatId);

  if (name === "start" || name === "vincular") {
    const code = arg.replace(/\s+/g, "").toUpperCase();
    if (!code) return { text: name === "start" ? HELLO : "Envía /vincular seguido del código que te da la app." };
    const result = await rpc.link(code, chatId);
    return {
      text:
        result === "linked"
          ? "¡Listo! Tu cuenta de Eslabón está vinculada. Si no has sido tú, envía /desvincular."
          : "El código no es válido o ha caducado. Genera otro en la app.",
    };
  }

  if (name === "hoy") {
    const view = todayView(await rpc.today(chatId));
    if (view) return view;
    const linked = (await rpc.status(chatId)) === "linked";
    return { text: linked ? "Aún no tienes hábitos. Créalos en la app." : LINK_FIRST };
  }

  if (name === "habitos") {
    const rows = await rpc.habits(chatId);
    return rows.length > 0 || (await isLinked(rpc, chatId)) ? listView(rows) : { text: LINK_FIRST };
  }

  if (name === "nuevo") return startCreate(arg || null, chatId, rpc);

  if (name === "ejemplo") {
    const result = await rpc.loadSample(chatId);
    if (result === "ok") return { text: "Datos de ejemplo cargados." };
    if (result === "not_empty") return { text: "Ya tienes hábitos: los datos de ejemplo solo se cargan en una cuenta vacía." };
    return { text: statusText(result) };
  }

  if (name === "desvincular") {
    const result = await rpc.unlink(chatId);
    return { text: result === "unlinked" ? "Tu cuenta se ha desvinculado." : "No había ninguna cuenta vinculada." };
  }

  return { text: HELP };
}

// Free text: the name the chat is waiting for, or the help when it waits for nothing (or it expired).
async function onText(text: string, chatId: number, rpc: BotRpc): Promise<View> {
  const pending = await rpc.pendingAction(chatId);
  if (pending === "create") return startCreate(text, chatId, rpc);
  if (pending !== "rename") return { text: HELP };
  const parsed = HabitName.safeParse(text);
  // A rejected name keeps the rename pending: the next text tries again.
  if (!parsed.success) return { text: parsed.error.issues[0].message };
  const result = await rpc.renameHabit(chatId, parsed.data);
  if (result === "ok") return { text: `Hábito renombrado a «${parsed.data}».` };
  return { text: result === "no_pending" ? HELP : statusText(result) };
}

// First step of a new habit: with a name (validated and trimmed like the web's, S-3), the palette; without one, ask
// for it. A rejected name keeps whatever was pending.
async function startCreate(text: string | null, chatId: number, rpc: BotRpc): Promise<View> {
  if (text === null) {
    const result = await rpc.startCreate(chatId, null);
    return { text: result === "ok" ? ASK_NAME : statusText(result) };
  }
  const parsed = HabitName.safeParse(text);
  if (!parsed.success) return { text: parsed.error.issues[0].message };
  const result = await rpc.startCreate(chatId, parsed.data);
  return result === "ok" ? paletteView(parsed.data) : { text: statusText(result) };
}

async function onCallback(data: Callback, chatId: number, rpc: BotRpc): Promise<Outcome> {
  switch (data[0]) {
    case "c": {
      const [, habitId, flag] = data;
      const result = await rpc.setCheckin(chatId, habitId, flag === "1");
      if (result !== "ok") return { answer: statusText(result) };
      return { answer: flag === "1" ? "Marcado" : "Desmarcado", view: todayView(await rpc.today(chatId)) ?? undefined };
    }
    case "d": {
      const [, habitId, day, flag] = data;
      const result = await rpc.setDay(chatId, habitId, day, flag === "1");
      if (result !== "ok") return { answer: statusText(result) };
      const row = (await rpc.habits(chatId)).find((r) => r.habit_id === habitId);
      if (!row) return { answer: HABIT_GONE };
      return { answer: flag === "1" ? "Marcado" : "Desmarcado", view: calendarView(row, day.slice(0, 7)) };
    }
    case "y": {
      const result = await rpc.deleteHabit(chatId, data[1]);
      if (result !== "ok") return { answer: statusText(result) };
      return { answer: "Borrado", view: listView(await rpc.habits(chatId)) };
    }
    case "k": {
      const result = await rpc.createHabit(chatId, data[1]);
      if (result === "no_pending") return { answer: NO_PENDING_COLOR };
      if (result !== "ok") return { answer: statusText(result) };
      // ponytail: the RPC does not return the habit, so the name is the newest one's (the list is in creation order);
      // a web creation in the same instant could show the other name. Return the name from the RPC if that matters.
      const newest = (await rpc.habits(chatId)).at(-1);
      return newest ? { view: { text: `Hábito «${newest.name}» creado.` } } : { answer: HABIT_GONE };
    }
    case "r": {
      const result = await rpc.startRename(chatId, data[1]);
      if (result !== "ok") return { answer: statusText(result) };
      const row = (await rpc.habits(chatId)).find((r) => r.habit_id === data[1]);
      return row ? { view: { text: `Escribe el nuevo nombre de «${row.name}».` } } : { answer: HABIT_GONE };
    }
    case "s": {
      const result = await rpc.loadSample(chatId);
      if (result !== "ok" && result !== "not_empty") return { answer: statusText(result) };
      return { view: listView(await rpc.habits(chatId)) };
    }
    case "l": {
      const rows = await rpc.habits(chatId);
      return rows.length > 0 || (await isLinked(rpc, chatId)) ? { view: listView(rows) } : { answer: LINK_FIRST };
    }
    case "h":
    case "m":
    case "x": {
      const rows = await rpc.habits(chatId);
      const row = rows.find((r) => r.habit_id === data[1]);
      if (!row) return { answer: rows.length > 0 || (await isLinked(rpc, chatId)) ? HABIT_GONE : LINK_FIRST };
      if (data[0] === "h") return { view: menuView(row) };
      if (data[0] === "x") return { view: confirmDeleteView(row) };
      // A month outside 2000-01…the link's month is not shown.
      return shownMonth(data[2], row.today) === data[2] ? { view: calendarView(row, data[2]) } : {};
    }
    // NOOP.
    default:
      return {};
  }
}

const isLinked = async (rpc: BotRpc, chatId: number) => (await rpc.status(chatId)) === "linked";

// What the user reads for a status an RPC returns instead of 'ok'.
function statusText(status: string): string {
  if (status === "not_linked") return LINK_FIRST;
  if (status === "not_found") return HABIT_GONE;
  if (status === "out_of_range") return OUT_OF_RANGE;
  if (status === "duplicate") return DUPLICATE_HABIT;
  if (status === "limit") return HABIT_LIMIT;
  return GENERIC_ERROR;
}

const button = (text: string, callback_data: string): Button => ({ text, callback_data });

// «<name>\nRacha actual: 3 días\nMejor racha: 5 días\nÚltimos 30 días: 27 %», the web's stats with the link's today.
const statsBlock = (row: HabitRow) =>
  [row.name, ...habitStats(row.days, row.today).map(([label, value]) => `${label}: ${value}`)].join("\n");

// Every habit with its stats and a button to its menu. With many habits the text is cut to fit Telegram's limit;
// the buttons still list them all.
function listView(rows: HabitRow[]): View {
  if (rows.length === 0) return { text: EMPTY_LIST, reply_markup: { inline_keyboard: [[button("Cargar datos de ejemplo", "s")]] } };
  const blocks = rows.map(statsBlock);
  const textOf = (shown: number) => {
    const more = shown < blocks.length ? [`Y ${blocks.length - shown} más: pulsa su botón para verlos.`] : [];
    return ["Tus hábitos:", ...blocks.slice(0, shown), ...more].join("\n\n");
  };
  // String length counts UTF-16 units, as Telegram does: a 60-emoji name is 120.
  let shown = blocks.length;
  while (textOf(shown).length > MAX_TEXT) shown--;
  return { text: textOf(shown), reply_markup: { inline_keyboard: rows.map((row) => [button(row.name, `h:${row.habit_id}`)]) } };
}

const paletteView = (name: string): View => ({
  text: `Elige un color para «${name}».`,
  reply_markup: {
    inline_keyboard: [COLOR_IDS.slice(0, 3), COLOR_IDS.slice(3)].map((ids) =>
      ids.map((id) => button(`${COLOR_EMOJI[id]} ${HABIT_COLORS[id].label}`, `k:${id}`)),
    ),
  },
});

function menuView(row: HabitRow): View {
  const id = row.habit_id;
  return {
    text: statsBlock(row),
    reply_markup: {
      inline_keyboard: [
        [button("📅 Historial", `m:${id}:${row.today.slice(0, 7)}`)],
        [button("✏️ Renombrar", `r:${id}`), button("🗑️ Borrar", `x:${id}`)],
        [button("⬅️ Volver", "l")],
      ],
    },
  };
}

const confirmDeleteView = (row: HabitRow): View => ({
  text: `¿Borrar «${row.name}» y todo su historial?`,
  reply_markup: { inline_keyboard: [[button("Sí, borrar", `y:${row.habit_id}`), button("Cancelar", `h:${row.habit_id}`)]] },
});

// The month as a keyboard, like the web's history: navigation between 2000-01 and the link's month, L–D, and one
// button per day, always with its number. A day up to today toggles («✅18» when marked, today as «(27)» until it
// is marked, then «✅27»: short enough for 7 columns); gaps and future days do nothing.
function calendarView(row: HabitRow, month: string): View {
  const { habit_id: id, today } = row;
  const marked = new Set(row.days);
  const dayButton = (day: Day | null) => {
    if (!day) return button("·", NOOP);
    const date = String(Number(day.slice(8)));
    if (day > today) return button(date, NOOP);
    if (marked.has(day)) return button(`✅${date}`, `d:${id}:${day}:0`);
    return button(day === today ? `(${date})` : date, `d:${id}:${day}:1`);
  };
  const nav = [
    ...(month > EARLIEST_MONTH ? [button("‹", `m:${id}:${addMonths(month, -1)}`)] : []),
    button(monthTitle(month), NOOP),
    ...(month < today.slice(0, 7) ? [button("›", `m:${id}:${addMonths(month, 1)}`)] : []),
  ];
  return {
    text: statsBlock(row),
    reply_markup: {
      inline_keyboard: [
        nav,
        WEEKDAY_LETTERS.map((letter) => button(letter, NOOP)),
        ...monthWeeks(month).map((week) => week.map(dayButton)),
        [button("⬅️ Volver", `h:${id}`)],
      ],
    },
  };
}

// The header with the RPC's today and one button per habit. null when there are no habits (or no link).
function todayView(rows: TodayRow[]): View | null {
  if (rows.length === 0) return null;
  // today is a calendar day: read at UTC midnight in UTC so no zone can move it to another day.
  const date = longDateIn(`${rows[0].today}T00:00:00Z`, "UTC");
  return {
    text: `Tus hábitos de hoy (${date}):`,
    reply_markup: {
      inline_keyboard: rows.map((row) => [
        button(`${row.done ? "✅" : "⬜"} ${row.name}`, `c:${row.habit_id}:${row.done ? 0 : 1}`),
      ]),
    },
  };
}
