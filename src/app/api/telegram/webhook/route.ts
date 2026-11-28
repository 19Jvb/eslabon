import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";
import { telegramApiBase } from "@/lib/telegram";
import { type BotRpc, BotRpcError, type TelegramApi, handleUpdate } from "@/lib/telegram-bot";

// Telegram's webhook. Only the secret set with setWebhook (secret_token) gets in; after that the answer is always 200,
// also for updates the bot does not understand or when Telegram fails, so Telegram does not retry them in a loop.
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return Response.json({ ok: false }, { status: 503 });
  // Equal-length hashes, so timingSafeEqual neither throws nor leaks the secret's length.
  const given = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!timingSafeEqual(sha256(given), sha256(secret))) return Response.json({ ok: false }, { status: 401 });

  try {
    const update: unknown = await request.json();
    await handleUpdate(update, { rpc: botRpc(secret), telegram: telegramApi() });
  } catch {
    // Fixed text: the error could carry the request URL, which holds the bot token.
    console.error("Telegram webhook: the update could not be handled.");
  }
  return Response.json({ ok: true });
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

// No user session and no service_role: the publishable key, and the bot secret as p_secret in every RPC.
function botRpc(secret: string): BotRpc {
  const supabase = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return {
    link: async (code, chatId) =>
      unwrap(await supabase.rpc("telegram_link", { p_secret: secret, p_code: code, p_chat_id: chatId })),
    unlink: async (chatId) => unwrap(await supabase.rpc("telegram_unlink", { p_secret: secret, p_chat_id: chatId })),
    status: async (chatId) => unwrap(await supabase.rpc("telegram_status", { p_secret: secret, p_chat_id: chatId })),
    today: async (chatId) => unwrap(await supabase.rpc("telegram_today", { p_secret: secret, p_chat_id: chatId })),
    setCheckin: async (chatId, habitId, done) =>
      unwrap(
        await supabase.rpc("telegram_set_checkin", {
          p_secret: secret,
          p_chat_id: chatId,
          p_habit_id: habitId,
          p_done: done,
        }),
      ),
    habits: async (chatId) => unwrap(await supabase.rpc("telegram_habits", { p_secret: secret, p_chat_id: chatId })),
    setDay: async (chatId, habitId, day, done) =>
      unwrap(
        await supabase.rpc("telegram_set_day", {
          p_secret: secret,
          p_chat_id: chatId,
          p_habit_id: habitId,
          p_day: day,
          p_done: done,
        }),
      ),
    deleteHabit: async (chatId, habitId) =>
      unwrap(await supabase.rpc("telegram_delete_habit", { p_secret: secret, p_chat_id: chatId, p_habit_id: habitId })),
    loadSample: async (chatId) =>
      unwrap(await supabase.rpc("telegram_load_sample", { p_secret: secret, p_chat_id: chatId })),
    // p_name left out (null in the DB) for /nuevo without a name.
    startCreate: async (chatId, name) =>
      unwrap(
        await supabase.rpc("telegram_start_create", { p_secret: secret, p_chat_id: chatId, p_name: name ?? undefined }),
      ),
    createHabit: async (chatId, color) =>
      unwrap(await supabase.rpc("telegram_create_habit", { p_secret: secret, p_chat_id: chatId, p_color: color })),
    startRename: async (chatId, habitId) =>
      unwrap(await supabase.rpc("telegram_start_rename", { p_secret: secret, p_chat_id: chatId, p_habit_id: habitId })),
    renameHabit: async (chatId, name) =>
      unwrap(await supabase.rpc("telegram_rename_habit", { p_secret: secret, p_chat_id: chatId, p_name: name })),
    pendingAction: async (chatId) =>
      unwrapNullable(await supabase.rpc("telegram_pending_action", { p_secret: secret, p_chat_id: chatId })),
    cancel: async (chatId) => {
      unwrapNullable(await supabase.rpc("telegram_cancel", { p_secret: secret, p_chat_id: chatId }));
    },
  };
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  const data = unwrapNullable(result);
  if (data === null) throw new BotRpcError("RPC failed");
  return data;
}

// For the RPCs where null is an answer (nothing pending) or the only one (void).
function unwrapNullable<T>({ data, error }: { data: T | null; error: unknown }): T | null {
  if (error) throw new BotRpcError("RPC failed");
  return data;
}

function telegramApi(): TelegramApi {
  const token = requireEnv("TELEGRAM_BOT_TOKEN", process.env.TELEGRAM_BOT_TOKEN);
  const base = telegramApiBase(process.env);
  return async (method, body) => {
    const response = await fetch(`${base}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Telegram API failed");
  };
}
