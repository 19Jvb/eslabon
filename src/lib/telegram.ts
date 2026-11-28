// The bot's deep link: opening it sends «/start <code>» to the bot, which links the chat in one tap.
export function telegramStartLink(bot: string, code: string): string {
  return `https://t.me/${bot}?start=${code}`;
}

// TELEGRAM_BOT_USERNAME as t.me expects it, also if it was written as «@Bot» or with spaces. Empty = no bot.
export function botUsername(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/^@/, "").trim();
}

// Where the bot token is sent. In production always to Telegram: TELEGRAM_API_BASE (the E2E simulator) only counts
// outside it, so a wrong variable there cannot hand the token to another host.
export function telegramApiBase(env: Record<string, string | undefined>): string {
  return (env.VERCEL_ENV !== "production" && env.TELEGRAM_API_BASE) || "https://api.telegram.org";
}
