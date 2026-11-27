import { cookies } from "next/headers";
import { type Day, timeZoneOrDefault, todayIn } from "@/lib/dates";

// The browser saves its zone in the «tz» cookie (TimeZoneCookie). Missing or not a valid zone means
// Europe/Madrid, never the server's UTC.
export async function userTimeZone(): Promise<string> {
  return timeZoneOrDefault((await cookies()).get("tz")?.value ?? "");
}

export async function userToday(): Promise<Day> {
  return todayIn(await userTimeZone());
}
