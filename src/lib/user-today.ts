import { cookies } from "next/headers";
import { type Day, todayIn } from "@/lib/dates";

// The browser saves its zone in the «tz» cookie (TimeZoneCookie); todayIn falls back to Europe/Madrid
// when it is missing or not a valid zone, never to the server's UTC.
export async function userToday(): Promise<Day> {
  return todayIn((await cookies()).get("tz")?.value ?? "");
}
