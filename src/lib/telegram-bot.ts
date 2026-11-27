import { z } from "zod";
import { longDateIn } from "@/lib/dates";

// The bot's RPCs (supabase/migrations/*_telegram.sql), already bound to the bot secret.
export type TodayRow = { habit_id: string; name: string; color: string; done: boolean; today: string };
export type BotRpc = {
  link(code: string, chatId: number): Promise<string>;
  unlink(chatId: number): Promise<string>;
  status(chatId: number): Promise<string>;
  today(chatId: number): Promise<TodayRow[]>;
  setCheckin(chatId: number, habitId: string, done: boolean): Promise<string>;
};
// POST to a Bot API method; rejects if Telegram does not accept it.
export type TelegramApi = (method: string, body: Record<string, unknown>) => Promise<void>;

const HELLO = "Hola, soy el bot de Eslabón. Para empezar, vincula tu cuenta desde la app con «Vincular con Telegram».";
const LINK_FIRST = "Primero vincula tu cuenta desde la app con «Vincular con Telegram».";
const HELP = [
  "Esto es lo que puedo hacer:",
  "/hoy: tus hábitos de hoy, para marcarlos o desmarcarlos",
  "/vincular <código>: vincula tu cuenta de Eslabón con el código de la app",
  "/desvincular: desvincula tu cuenta",
  "/ayuda: esta lista",
].join("\n");

// Only the fields the bot reads. Anything else (edited_message, my_chat_member…) does not match and is ignored.
const Chat = z.object({ id: z.int(), type: z.string() });
const Update = z.object({
  message: z.object({ chat: Chat, text: z.string() }).optional(),
  callback_query: z
    .object({ id: z.string(), data: z.string(), message: z.object({ message_id: z.int(), chat: Chat }) })
    .optional(),
});
// «c:<habit_id>:<1|0>», 1 = mark. Built by todayView.
const CallbackData = z.tuple([z.literal("c"), z.uuid(), z.enum(["0", "1"])]);
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
    const [, habitId, flag] = data.data;
    const result = await rpc.setCheckin(chatId, habitId, flag === "1");
    const text =
      result === "ok" ? (flag === "1" ? "Marcado" : "Desmarcado") : result === "not_found" ? "Ese hábito ya no existe." : LINK_FIRST;
    await telegram("answerCallbackQuery", { callback_query_id: query.id, text });
    if (result !== "ok") return;
    const view = todayView(await rpc.today(chatId));
    if (view) await telegram("editMessageText", { chat_id: chatId, message_id: query.message.message_id, ...view });
    return;
  }

  if (!message) return;
  const chatId = message.chat.id;
  const command = COMMAND.exec(message.text.trim());
  const send = (text: string, extra: Record<string, unknown> = {}) =>
    telegram("sendMessage", { chat_id: chatId, text, ...extra });

  if (message.chat.type !== "private") {
    if (command) await send("Úsame en un chat privado.");
    return;
  }

  const name = command?.[1].toLowerCase();
  const code = (command?.[2] ?? "").replace(/\s+/g, "").toUpperCase();

  if (name === "start" || name === "vincular") {
    if (!code) return send(name === "start" ? HELLO : "Envía /vincular seguido del código que te da la app.");
    const result = await rpc.link(code, chatId);
    return send(
      result === "linked"
        ? "¡Listo! Tu cuenta de Eslabón está vinculada. Si no has sido tú, envía /desvincular."
        : "El código no es válido o ha caducado. Genera otro en la app.",
    );
  }

  if (name === "hoy") {
    const view = todayView(await rpc.today(chatId));
    if (view) return send(view.text, { reply_markup: view.reply_markup });
    const linked = (await rpc.status(chatId)) === "linked";
    return send(linked ? "Aún no tienes hábitos. Créalos en la app." : LINK_FIRST);
  }

  if (name === "desvincular") {
    const result = await rpc.unlink(chatId);
    return send(result === "unlinked" ? "Tu cuenta se ha desvinculado." : "No había ninguna cuenta vinculada.");
  }

  return send(HELP);
}

// The header with the RPC's today and one button per habit. null when there are no habits (or no link).
function todayView(rows: TodayRow[]) {
  if (rows.length === 0) return null;
  // today is a calendar day: read at UTC midnight in UTC so no zone can move it to another day.
  const date = longDateIn(`${rows[0].today}T00:00:00Z`, "UTC");
  return {
    text: `Tus hábitos de hoy (${date}):`,
    reply_markup: {
      inline_keyboard: rows.map((row) => [
        { text: `${row.done ? "✅" : "⬜"} ${row.name}`, callback_data: `c:${row.habit_id}:${row.done ? 0 : 1}` },
      ]),
    },
  };
}
