// The bot's deep link: opening it sends «/start <code>» to the bot, which links the chat in one tap.
export function telegramStartLink(bot: string, code: string): string {
  return `https://t.me/${bot}?start=${code}`;
}

// TELEGRAM_BOT_USERNAME as t.me expects it, also if it was written as «@Bot» or with spaces. Empty = no bot.
export function botUsername(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/^@/, "").trim();
}
