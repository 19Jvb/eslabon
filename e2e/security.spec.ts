import { expect, request as playwrightRequest, type APIResponse, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  announced,
  button,
  cleanUp,
  env,
  expectNoSeriousA11yViolations,
  field,
  openApp,
  prefix,
  seed,
  test,
} from "./helpers";

// T24: las correcciones de la auditoría de seguridad. Con el usuario de E2E (todo lo sembrado empieza por «e2e-» y se
// borra al terminar). La cuenta demo solo inicia sesión por la API y nunca escribe en su cuenta: sus intentos contra el
// usuario de E2E los rechaza la BD.

const NO_SESSION = { cookies: [], origins: [] };
const LIMIT = "Has llegado al máximo de 50 hábitos.";
const MAX = 50;

test.afterEach(async ({ api }) => {
  await cleanUp(api);
});

// ---------------------------------------------------------------- SEC-3: cabeceras

const CSP = ["frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"];

function expectSecurityHeaders(response: APIResponse, label: string) {
  const headers = response.headers();
  expect(headers["x-frame-options"], `${label}: X-Frame-Options`).toBe("DENY");
  expect(headers["x-content-type-options"], `${label}: X-Content-Type-Options`).toBe("nosniff");
  expect(headers["referrer-policy"], `${label}: Referrer-Policy`).toBe("strict-origin-when-cross-origin");
  const csp = (headers["content-security-policy"] ?? "")
    .split(";")
    .map((directive) => directive.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  expect(csp.sort(), `${label}: CSP con las 4 directivas, y nada más (sin script-src ni default-src)`).toEqual([...CSP].sort());
}

test("SEC-3: cabeceras de seguridad en las páginas públicas, en /app sin sesión (307), en el 404 y en el webhook", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL, storageState: NO_SESSION });
  try {
    for (const [path, status] of [
      ["/", 200],
      ["/login", 200],
      ["/registro", 200],
      ["/app", 307],
      [`/app/habitos/${crypto.randomUUID()}`, 307],
      ["/una-ruta-que-no-existe", 404],
      ["/manifest.webmanifest", 200],
    ] as const) {
      const response = await anonymous.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(status);
      expectSecurityHeaders(response, path);
    }
    // Sin el secreto de Telegram: 401 (o 503 si el servidor no tiene el secreto). Las cabeceras, igual.
    const webhook = await anonymous.post("/api/telegram/webhook", { data: { update_id: 1 } });
    expect([401, 503], "webhook sin secreto").toContain(webhook.status());
    expectSecurityHeaders(webhook, "POST /api/telegram/webhook");
  } finally {
    await anonymous.dispose();
  }
});

test("SEC-3: con sesión, /app y /app/habitos/<id> llevan las cabeceras de seguridad y siguen con Cache-Control private, no-store", async ({ api, session, baseURL }) => {
  const [id] = await seed(api, { name: `${prefix()}-cabeceras` });
  const withSession = await playwrightRequest.newContext({ baseURL, storageState: session.storageState });
  try {
    for (const [path, status] of [
      ["/app", 200],
      [`/app/habitos/${id}`, 200],
      [`/app/habitos/${crypto.randomUUID()}`, 404],
    ] as const) {
      const response = await withSession.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(status);
      expectSecurityHeaders(response, path);
      const cacheControl = response.headers()["cache-control"] ?? "";
      expect(cacheControl, `${path}: private`).toContain("private");
      expect(cacheControl, `${path}: no-store`).toContain("no-store");
    }
  } finally {
    await withSession.dispose();
  }
});

/** Las infracciones de la CSP que vea el navegador (el evento securitypolicyviolation y los «Refused to …» de la consola). */
async function watchCsp(page: Page) {
  const seen: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|refused to/i.test(message.text())) seen.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Refused to (securitypolicyviolation) ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return seen;
}

test("SEC-3: nada se rompe con la CSP: /, /login, /app y el historial cargan, se crea, se marca y se navega sin infracciones", async ({ page, api }) => {
  const seen = await watchCsp(page);
  const name = `${prefix()}-csp`;
  for (const path of ["/", "/login", "/registro"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first(), path).toBeVisible();
  }
  await openApp(page);
  await field(page, "Nombre").fill(name);
  await button(page, "Crear").click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  const { data } = await api.from("habits").select("id").eq("name", name).single();
  await page.goto(`/app/habitos/${data!.id}`);
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Volver a tus hábitos", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
  expect(seen, "infracciones de la CSP").toEqual([]);
});

// ---------------------------------------------------------------- SEC-6: cookies de sesión

test("SEC-6: las cookies de sesión de Supabase son httpOnly, Secure y SameSite=Lax, y no se leen desde la página", async ({ page, session }) => {
  const auth = session.storageState.cookies.filter((cookie) => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name));
  expect(auth.length, "hay al menos una cookie de sesión sb-…-auth-token").toBeGreaterThan(0);
  for (const cookie of auth) {
    expect(cookie.httpOnly, `${cookie.name}: httpOnly`).toBe(true);
    expect(cookie.sameSite, `${cookie.name}: SameSite`).toBe("Lax");
    // Build de producción siempre: `next start` en local (localhost es un origen seguro) y Vercel (https).
    expect(cookie.secure, `${cookie.name}: Secure`).toBe(true);
  }
  await openApp(page);
  expect(await page.evaluate(() => document.cookie), "document.cookie no ve la sesión").not.toContain("auth-token");
});

// ---------------------------------------------------------------- SEC-1: límite de 50 hábitos

const userIdOf = (accessToken: string): string =>
  JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")).sub;

/** Lleva al usuario de E2E a `target` hábitos con hábitos «e2e-…» (de una vez: un insert de varias filas). */
async function fillTo(api: SupabaseClient, target: number, tag: string) {
  const { count, error } = await api.from("habits").select("id", { count: "exact", head: true });
  if (error || count === null) throw new Error(`No se pudo contar los hábitos: ${error?.message}`);
  if (count > target) throw new Error(`El usuario de E2E ya tiene ${count} hábitos (más de ${target})`);
  const rows = Array.from({ length: target - count }, (_, i) => ({ name: `${tag}-${i + 1}` }));
  if (rows.length) {
    const { error: insertError } = await api.from("habits").insert(rows);
    if (insertError) throw new Error(`No se pudo llegar a ${target} hábitos: ${insertError.message}`);
  }
}

const habitCount = async (api: SupabaseClient) => (await api.from("habits").select("id", { count: "exact", head: true })).count;

test("SEC-1: con 50 hábitos, el nº 51 por la API → error 23514 y sigue en 50; el nº 50 sí entra", async ({ api }) => {
  const tag = prefix();
  await fillTo(api, MAX - 1, tag);
  const fiftieth = await api.from("habits").insert({ name: `${tag}-50` });
  expect(fiftieth.error, "el nº 50 entra").toBeNull();
  const extra = await api.from("habits").insert({ name: `${tag}-51` });
  expect(extra.error?.code, "el nº 51 lo rechaza la BD").toBe("23514");
  const batch = await api.from("habits").insert([{ name: `${tag}-52` }, { name: `${tag}-53` }]);
  expect(batch.error?.code, "un insert de varias filas tampoco pasa").toBe("23514");
  expect(await habitCount(api)).toBe(MAX);
});

test("SEC-1: inserts simultáneos (10 a la vez con 45) → entran exactamente 5 y se queda en 50", async ({ api }) => {
  const tag = prefix();
  await fillTo(api, MAX - 5, tag);
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => api.from("habits").insert({ name: `${tag}-par-${i}` })),
  );
  const passed = results.filter((result) => !result.error).length;
  const codes = results.flatMap((result) => (result.error ? [result.error.code] : []));
  expect(passed, `entran 5 (códigos de los rechazados: ${codes.join(", ")})`).toBe(5);
  expect(new Set(codes), "los rechazados, por el límite").toEqual(new Set(["23514"]));
  expect(await habitCount(api)).toBe(MAX);
});

test("SEC-1: la respuesta a un hábito a nombre de otro no depende de sus datos: la demo contra el usuario de E2E en 50 → 42501 (RLS), no el límite", async ({ api, session }) => {
  const tag = prefix();
  await fillTo(api, MAX, tag);
  const demo = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await demo.auth.signInWithPassword({ email: env("DEMO_EMAIL"), password: env("DEMO_PASSWORD") });
  if (loginError) throw new Error(`No se pudo iniciar sesión como la demo: ${loginError.message}`);
  const intrusion = await demo.from("habits").insert({ user_id: userIdOf(session.accessToken), name: `${tag}-intruso` });
  expect(intrusion.error?.code, "la RLS lo rechaza antes de mirar cuántos hábitos tiene el otro").toBe("42501");
  expect(await habitCount(api)).toBe(MAX);
  await demo.auth.signOut({ scope: "local" });
});

test("SEC-1: en la app, el nº 51 → «Has llegado al máximo de 50 hábitos.» anunciado junto a «Nombre», sin el error crudo, y no se crea", async ({ page, api }) => {
  const tag = prefix();
  await fillTo(api, MAX, tag);
  await openApp(page);
  const name = `${tag}-51`;
  await field(page, "Nombre").fill(name);
  await button(page, "Crear").click();

  await expect(announced(page, LIMIT)).toBeVisible();
  const describedBy = (await field(page, "Nombre").getAttribute("aria-describedby")) ?? "";
  expect(describedBy, "el campo apunta a su error").not.toBe("");
  await expect(page.locator(describedBy.split(/\s+/).map((id) => `[id="${id}"]`).join(", ")).filter({ hasText: LIMIT })).toHaveCount(1);
  await expect(field(page, "Nombre"), "se conserva lo escrito").toHaveValue(name);
  await expect(page.getByText(/habit limit|23514|check_violation/i), "sin el error crudo de la BD").toHaveCount(0);
  expect(await habitCount(api)).toBe(MAX);
  const { data } = await api.from("habits").select("id").eq("name", name);
  expect(data ?? []).toEqual([]);
  await expectNoSeriousA11yViolations(page);
});
