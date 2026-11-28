import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect } from "@playwright/test";
import { EARLIEST_DAY, addDays } from "../src/lib/dates";
import { MADRID, apiClient, dayAt, env, mark, marked, prefix, seed, test, wipeAll } from "./helpers";

// T26 (fase B): las RPC del bot completo contra el proyecto alojado, por la API y como lo haría el webhook (anon +
// TELEGRAM_WEBHOOK_SECRET). En rojo hasta el `db push` de la migración telegram_full.
// El usuario de E2E es solo para tests: se borran todos sus hábitos y su vínculo antes y después de cada test.
// La cuenta demo solo se lee (y, si no tiene hábitos, se le crea uno «e2e-…» que se borra al terminar). Su vínculo con
// Telegram no se toca: vincularla a un chat ficticio le quitaría el suyo.
// Lo que no se puede probar aquí (la caducidad de 10 minutos, las mutaciones, el catálogo y la ACL) está en la fase A.

const MAX = 50;
const BAD_SECRET = "x".repeat(40);
const RPCS = [
  "telegram_habits", "telegram_set_day", "telegram_start_create", "telegram_create_habit", "telegram_start_rename",
  "telegram_pending_action", "telegram_rename_habit", "telegram_cancel", "telegram_delete_habit", "telegram_load_sample",
] as const;
type Rpc = (typeof RPCS)[number];
type Row = { habit_id: string; name: string; color: string; days: string[]; today: string };

/** Chat ficticio: grande, aleatorio y positivo (un chat privado), dentro de los enteros seguros de JS. */
const fakeChat = () => 8_000_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000_000_000);

/** Como el webhook: anon con el secreto del bot. Devuelve data o lanza con el código del error. */
async function bot<T = string>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await apiClient().rpc(fn, { p_secret: env("TELEGRAM_WEBHOOK_SECRET"), ...args });
  if (error) throw new Error(`${fn} falló: ${error.code} ${error.message}`);
  return data as T;
}
/** El código de error de una llamada que tiene que fallar (o "ok" si no falla). */
async function errorOf(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { error } = await client.rpc(fn, args);
  return error?.code ?? "ok";
}

const habits = (chat: number) => bot<Row[]>("telegram_habits", { p_chat_id: chat });
const setDay = (chat: number, habit: string, day: string | null, done: boolean) =>
  bot("telegram_set_day", { p_chat_id: chat, p_habit_id: habit, p_day: day, p_done: done });
const pending = (chat: number) => bot<string | null>("telegram_pending_action", { p_chat_id: chat });
const startCreate = (chat: number, name?: string | null) =>
  bot("telegram_start_create", name === undefined ? { p_chat_id: chat } : { p_chat_id: chat, p_name: name });
const createHabit = (chat: number, color: string | null) => bot("telegram_create_habit", { p_chat_id: chat, p_color: color });
const startRename = (chat: number, habit: string) => bot("telegram_start_rename", { p_chat_id: chat, p_habit_id: habit });
const rename = (chat: number, name: string | null) => bot("telegram_rename_habit", { p_chat_id: chat, p_name: name });
const remove = (chat: number, habit: string) => bot("telegram_delete_habit", { p_chat_id: chat, p_habit_id: habit });

/** Vincula al usuario de E2E con un chat (nuevo si no se pasa) por el camino real: código como el usuario + RPC del bot. */
async function link(api: SupabaseClient, tz = MADRID, chat = fakeChat()) {
  const { data: code, error } = await api.rpc("create_telegram_link_code", { p_tz: tz });
  if (error) throw new Error(`create_telegram_link_code falló: ${error.code} ${error.message}`);
  expect(await bot("telegram_link", { p_code: code, p_chat_id: chat })).toBe("linked");
  return chat;
}
async function unlinkAll(api: SupabaseClient) {
  const { error } = await api.from("telegram_links").delete().not("user_id", "is", null);
  if (error) throw new Error(`No se pudo desvincular al usuario de E2E: ${error.message}`);
}

/** Hábitos y días del usuario de E2E (nombre, color y días), para comprobar que algo no cambia. */
async function snapshot(api: SupabaseClient) {
  const h = await api.from("habits").select("id, name, color").order("id");
  const c = await api.from("check_ins").select("habit_id, day").order("habit_id").order("day");
  if (h.error || c.error) throw new Error(`No se pudo leer: ${h.error?.message ?? c.error?.message}`);
  return JSON.stringify([h.data, c.data]);
}
const habitCount = async (api: SupabaseClient) => {
  const { count, error } = await api.from("habits").select("id", { count: "exact", head: true });
  if (error || count === null) throw new Error(`No se pudo contar: ${error?.message}`);
  return count;
};
async function fillTo(api: SupabaseClient, target: number, tag: string) {
  const rows = Array.from({ length: target - (await habitCount(api)) }, (_, i) => ({ name: `${tag}-${i + 1}` }));
  if (rows.length) {
    const { error } = await api.from("habits").insert(rows);
    if (error) throw new Error(`No se pudo llegar a ${target}: ${error.message}`);
  }
}
/** El «hoy» de la zona ahora o hace 5 minutos (por si la llamada cruzó la medianoche). */
const todayOk = (tz: string, day: string) => [dayAt(tz, new Date()), dayAt(tz, new Date(Date.now() - 5 * 60_000))].includes(day);

test.beforeEach(async ({ api }) => {
  await unlinkAll(api);
  await wipeAll(api);
});

test.afterEach(async ({ api }) => {
  await unlinkAll(api);
  await wipeAll(api);
});

test.describe("T26: el secreto, el rol y sin vínculo", () => {
  test("las 10 RPC existen y, con un secreto incorrecto, vacío o sin él → 42501; nada cambia", async ({ api }) => {
    const [id] = await seed(api, { name: `${prefix()}-a` });
    const chat = await link(api);
    const before = await snapshot(api);
    const args: Record<Rpc, Record<string, unknown>> = {
      telegram_habits: {}, telegram_pending_action: {}, telegram_cancel: {}, telegram_load_sample: {},
      telegram_set_day: { p_habit_id: id, p_day: dayAt(MADRID, new Date()), p_done: true },
      telegram_start_create: { p_name: "Nuevo" }, telegram_create_habit: { p_color: "blue" },
      telegram_start_rename: { p_habit_id: id }, telegram_rename_habit: { p_name: "Otro" }, telegram_delete_habit: { p_habit_id: id },
    };
    for (const fn of RPCS) {
      for (const secret of [BAD_SECRET, "", null]) {
        const code = await errorOf(apiClient(), fn, { p_secret: secret, p_chat_id: chat, ...args[fn] });
        expect(code, `${fn} con el secreto ${JSON.stringify(secret?.slice(0, 3))}… (PGRST202 = la función no existe)`).toBe("42501");
      }
    }
    expect(await snapshot(api)).toBe(before);
    expect(await pending(chat)).toBeNull();
  });

  test("como authenticated, aun con el secreto bueno → 42501 (solo anon tiene execute)", async ({ api }) => {
    const chat = await link(api);
    for (const fn of ["telegram_habits", "telegram_pending_action", "telegram_cancel", "telegram_load_sample"] as const) {
      const code = await errorOf(api, fn, { p_secret: env("TELEGRAM_WEBHOOK_SECRET"), p_chat_id: chat });
      expect(code, `${fn} como el usuario`).toBe("42501");
    }
    const { error } = await api.schema("private").from("telegram_pending").select("*");
    expect(error, "private.telegram_pending no se expone por la API").not.toBeNull();
  });

  test("sin vínculo: 0 filas, null o not_linked en cada RPC, y nada cambia", async ({ api }) => {
    const [id] = await seed(api, { name: `${prefix()}-a` });
    const before = await snapshot(api);
    const chat = fakeChat();
    expect(await habits(chat)).toEqual([]);
    expect(await setDay(chat, id, dayAt(MADRID, new Date()), true)).toBe("not_linked");
    expect(await startCreate(chat, "Nuevo")).toBe("not_linked");
    expect(await startCreate(chat)).toBe("not_linked");
    expect(await createHabit(chat, "blue")).toBe("not_linked");
    expect(await startRename(chat, id)).toBe("not_linked");
    expect(await rename(chat, "Otro")).toBe("not_linked");
    expect(await remove(chat, id)).toBe("not_linked");
    expect(await bot("telegram_load_sample", { p_chat_id: chat })).toBe("not_linked");
    expect(await pending(chat)).toBeNull();
    await bot("telegram_cancel", { p_chat_id: chat });
    expect(await snapshot(api)).toBe(before);
  });
});

test.describe("T26: aislamiento con la cuenta demo", () => {
  let demo: SupabaseClient;
  let demoHabit: string;
  let created = false;

  test.beforeAll(async () => {
    demo = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await demo.auth.signInWithPassword({ email: env("DEMO_EMAIL"), password: env("DEMO_PASSWORD") });
    if (error) throw new Error(`No se pudo iniciar sesión como la demo: ${error.message}`);
    const { data } = await demo.from("habits").select("id").limit(1);
    if (data?.length) demoHabit = data[0].id;
    else {
      [demoHabit] = await seed(demo, { name: `${prefix()}-demo` });
      created = true;
    }
  });

  test.afterAll(async () => {
    if (created) await demo.from("habits").delete().eq("id", demoHabit);
    await demo.auth.signOut({ scope: "local" });
  });

  test("desde el chat del usuario de E2E, sobre un hábito de la demo: marcar, desmarcar, renombrar y borrar → not_found; la demo no cambia", async ({ api }) => {
    const chat = await link(api);
    const demoBefore = JSON.stringify([
      (await demo.from("habits").select("id, name, color").eq("id", demoHabit)).data,
      await marked(demo, demoHabit),
    ]);
    const days = await marked(demo, demoHabit);
    expect(await setDay(chat, demoHabit, dayAt(MADRID, new Date()), true)).toBe("not_found");
    expect(await setDay(chat, demoHabit, days[0] ?? "2020-01-01", false)).toBe("not_found");
    expect(await setDay(chat, demoHabit, "1999-01-01", true), "fuera de rango tampoco dice nada de un hábito ajeno").toBe("not_found");
    expect(await startRename(chat, demoHabit)).toBe("not_found");
    expect(await pending(chat), "no queda un rename pendiente con el hábito ajeno").toBeNull();
    expect(await rename(chat, "Hackeado")).toBe("no_pending");
    expect(await remove(chat, demoHabit)).toBe("not_found");
    expect((await habits(chat)).map((r) => r.habit_id)).not.toContain(demoHabit);
    const demoAfter = JSON.stringify([
      (await demo.from("habits").select("id, name, color").eq("id", demoHabit)).data,
      await marked(demo, demoHabit),
    ]);
    expect(demoAfter).toBe(demoBefore);
  });
});

test.describe("T26: ver y marcar", () => {
  test("telegram_habits: en el orden de la web, con todos los días ascendentes y el hoy del vínculo; lo que marca el bot lo ve la web", async ({ api }) => {
    const p = prefix();
    const [a, b] = await seed(api, { name: `${p}-a`, color: "red" }, { name: `${p}-b` });
    await mark(api, a, "2026-01-05", EARLIEST_DAY, "2024-02-29");
    const chat = await link(api);
    const rows = await habits(chat);
    expect(rows.map((r) => [r.habit_id, r.name, r.color])).toEqual([[a, `${p}-a`, "red"], [b, `${p}-b`, "green"]]);
    expect(rows[0].days).toEqual([EARLIEST_DAY, "2024-02-29", "2026-01-05"]);
    expect(rows[1].days).toEqual([]);
    expect(todayOk(MADRID, rows[0].today), `today ${rows[0].today} es el de Madrid`).toBe(true);
    expect(await setDay(chat, b, rows[0].today, true)).toBe("ok");
    expect(await marked(api, b)).toEqual([rows[0].today]);
  });

  for (const tz of [MADRID, "Pacific/Kiritimati", "Etc/GMT+12"]) {
    test(`telegram_set_day en ${tz}: de ${EARLIEST_DAY} al hoy del vínculo, idempotente; mañana, 1999-12-31 y null → out_of_range`, async ({ api }) => {
      const [id] = await seed(api, { name: `${prefix()}-d` });
      const chat = await link(api, tz);
      const today = (await habits(chat))[0].today;
      expect(todayOk(tz, today), `today ${today} es el de ${tz}`).toBe(true);
      expect(await setDay(chat, id, today, true)).toBe("ok");
      expect(await setDay(chat, id, today, true)).toBe("ok");
      expect(await setDay(chat, id, EARLIEST_DAY, true)).toBe("ok");
      expect(await setDay(chat, id, addDays(today, 1), true)).toBe("out_of_range");
      expect(await setDay(chat, id, "1999-12-31", true)).toBe("out_of_range");
      expect(await setDay(chat, id, null, true)).toBe("out_of_range");
      expect(await marked(api, id)).toEqual([EARLIEST_DAY, today]);
      expect(await setDay(chat, id, today, false)).toBe("ok");
      expect(await setDay(chat, id, today, false)).toBe("ok");
      expect(await marked(api, id)).toEqual([EARLIEST_DAY]);
      const code = await errorOf(apiClient(), "telegram_set_day", {
        p_secret: env("TELEGRAM_WEBHOOK_SECRET"), p_chat_id: chat, p_habit_id: id, p_day: today, p_done: null,
      });
      expect(code, "p_done null").toBe("22023");
    });
  }
});

test.describe("T26: crear, renombrar, borrar y datos de ejemplo", () => {
  test("crear: nombre no válido, duplicado sin mayúsculas, color fuera de la paleta; y 10 toques simultáneos en el color → un solo hábito", async ({ api }) => {
    const p = prefix();
    await seed(api, { name: `${p}-a` });
    const chat = await link(api);
    for (const name of ["", " x", "x ", `${p}-`.padEnd(61, "x")]) expect(await startCreate(chat, name), `«${name}»`).toBe("invalid");
    expect(await startCreate(chat, `${p}-A`.toUpperCase())).toBe("duplicate");
    expect(await pending(chat)).toBeNull();
    expect(await startCreate(chat)).toBe("ok");
    expect(await pending(chat), "/nuevo a secas: espera el nombre").toBe("create");
    expect(await createHabit(chat, "blue"), "sin nombre todavía").toBe("no_pending");
    expect(await startCreate(chat, `${p}-nuevo`)).toBe("ok");
    expect(await createHabit(chat, "pink")).toBe("invalid");
    expect(await pending(chat), "un color no válido conserva lo pendiente").toBe("create");
    const results = await Promise.all(Array.from({ length: 10 }, () => createHabit(chat, "violet")));
    expect(results.filter((r) => r === "ok"), results.join(", ")).toHaveLength(1);
    expect(new Set(results.filter((r) => r !== "ok"))).toEqual(new Set(["no_pending"]));
    const { data } = await api.from("habits").select("name, color").eq("name", `${p}-nuevo`);
    expect(data).toEqual([{ name: `${p}-nuevo`, color: "violet" }]);
    expect(await pending(chat)).toBeNull();
  });

  test("límite: con 49 el bot crea el nº 50 y luego start_create → limit y la web → 23514; si la web llena el hueco entre el nombre y el color, create_habit → limit", async ({ api }) => {
    const p = prefix();
    await fillTo(api, MAX - 1, p);
    const chat = await link(api);
    expect(await startCreate(chat, `${p}-bot`)).toBe("ok");
    expect(await createHabit(chat, "blue")).toBe("ok");
    expect(await habitCount(api)).toBe(MAX);
    expect(await startCreate(chat, `${p}-bot2`)).toBe("limit");
    expect(await startCreate(chat)).toBe("limit");
    expect((await api.from("habits").insert({ name: `${p}-web` })).error?.code).toBe("23514");
    expect(await bot("telegram_load_sample", { p_chat_id: chat })).toBe("not_empty");
    expect(await habitCount(api)).toBe(MAX);
    const { data } = await api.from("habits").select("id").eq("name", `${p}-1`);
    expect(await remove(chat, data![0].id)).toBe("ok");
    expect(await startCreate(chat, `${p}-tarde`)).toBe("ok");
    expect((await api.from("habits").insert({ name: `${p}-web-hueco` })).error, "la web ocupa el nº 50").toBeNull();
    expect(await createHabit(chat, "blue")).toBe("limit");
    expect(await pending(chat), "el límite conserva lo pendiente").toBe("create");
    expect(await habitCount(api)).toBe(MAX);
  });

  test("límite con concurrencia real: con 49, el bot y 5 inserts de la web a la vez → entra exactamente 1 y se queda en 50", async ({ api }) => {
    const p = prefix();
    await fillTo(api, MAX - 1, p);
    const chat = await link(api);
    expect(await startCreate(chat, `${p}-bot`)).toBe("ok");
    const [fromBot, ...fromWeb] = await Promise.all([
      createHabit(chat, "blue"),
      ...Array.from({ length: 5 }, (_, i) => api.from("habits").insert({ name: `${p}-web-${i}` })),
    ]);
    const webOk = fromWeb.filter((r) => !r.error).length;
    expect(["ok", "limit"], `el bot: ${fromBot}`).toContain(fromBot);
    expect(webOk + (fromBot === "ok" ? 1 : 0), `bot ${fromBot}, web ${webOk}`).toBe(1);
    expect(new Set(fromWeb.flatMap((r) => (r.error ? [r.error.code] : [])))).toEqual(new Set(["23514"]));
    expect(await habitCount(api)).toBe(MAX);
  });

  test("renombrar: no válido y duplicado conservan lo pendiente; ok renombra y lo borra; si el hábito se borra antes → not_found", async ({ api }) => {
    const p = prefix();
    const [a, b] = await seed(api, { name: `${p}-a` }, { name: `${p}-b` });
    const chat = await link(api);
    expect(await startRename(chat, a)).toBe("ok");
    expect(await pending(chat)).toBe("rename");
    expect(await rename(chat, " x")).toBe("invalid");
    expect(await rename(chat, `${p}-B`.toUpperCase())).toBe("duplicate");
    expect(await pending(chat)).toBe("rename");
    expect(await rename(chat, `${p}-renombrado`)).toBe("ok");
    expect(await pending(chat)).toBeNull();
    expect(await rename(chat, `${p}-otra`)).toBe("no_pending");
    expect((await api.from("habits").select("name").eq("id", a)).data).toEqual([{ name: `${p}-renombrado` }]);
    expect(await startRename(chat, b)).toBe("ok");
    expect(await remove(chat, b)).toBe("ok");
    expect(await rename(chat, `${p}-tarde`)).toBe("not_found");
    expect(await pending(chat)).toBeNull();
    expect(await remove(chat, b), "borrar dos veces").toBe("not_found");
  });

  test("borrar: el hábito y su historial; la web ya no los ve", async ({ api }) => {
    const [id] = await seed(api, { name: `${prefix()}-x` });
    await mark(api, id, "2020-01-01", "2021-01-01");
    const chat = await link(api);
    expect(await remove(chat, id)).toBe("ok");
    expect((await api.from("habits").select("id").eq("id", id)).data).toEqual([]);
    expect(await marked(api, id)).toEqual([]);
  });

  test("datos de ejemplo por el bot: sin hábitos → ok, el mismo patrón que la web contado desde el hoy del vínculo; otra vez → not_empty", async ({ api }) => {
    const chat = await link(api);
    expect(await bot("telegram_load_sample", { p_chat_id: chat })).toBe("ok");
    const rows = await habits(chat);
    const pattern = (r: Row[]) => r.map((h) => ({ name: h.name, color: h.color, offsets: h.days.map((d) => (Date.parse(d) - Date.parse(h.today)) / 86_400_000) }))
      .sort((x, y) => x.name.localeCompare(y.name));
    const fromBot = pattern(rows);
    expect(fromBot.map((h) => h.name)).toEqual(["Beber 2 litros de agua", "Caminar 30 minutos", "Leer 20 minutos"]);
    expect(fromBot.every((h) => h.offsets.length > 0 && h.offsets.every((o) => o < 0)), "hoy nunca queda marcado").toBe(true);
    expect(await bot("telegram_load_sample", { p_chat_id: chat })).toBe("not_empty");
    await wipeAll(api);
    const { error } = await api.rpc("load_sample_data", { p_today: rows[0].today });
    expect(error, "la web sigue igual").toBeNull();
    expect(pattern(await habits(chat))).toEqual(fromBot);
  });

  test("desvincular y volver a vincular borran lo pendiente del chat", async ({ api }) => {
    const [id] = await seed(api, { name: `${prefix()}-a` });
    const chat = await link(api);
    expect(await startCreate(chat, "Pendiente")).toBe("ok");
    expect(await bot("telegram_unlink", { p_chat_id: chat })).toBe("unlinked");
    await link(api, MADRID, chat);
    expect(await pending(chat), "tras desvincular").toBeNull();
    expect(await startRename(chat, id)).toBe("ok");
    await link(api, MADRID, chat);
    expect(await pending(chat), "tras volver a vincular sin desvincular").toBeNull();
    expect(await startCreate(chat, "Otro")).toBe("ok");
    await bot("telegram_cancel", { p_chat_id: chat });
    expect(await pending(chat), "telegram_cancel").toBeNull();
  });
});
