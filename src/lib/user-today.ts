import { cookies } from "next/headers";
import { connection } from "next/server";
import { type Day, timeZoneOrDefault, todayIn } from "@/lib/dates";

// The browser saves its zone in the «tz» cookie (TimeZoneCookie). Missing or not a valid zone means
// Europe/Madrid, never the server's UTC.
export async function userTimeZone(): Promise<string> {
  return timeZoneOrDefault((await cookies()).get("tz")?.value ?? "");
}

// connection() first: in a runtime prefetch cookies() resolves too, and reading the clock there is not allowed.
export async function userToday(): Promise<Day> {
  await connection();
  return todayIn(await userTimeZone());
}
