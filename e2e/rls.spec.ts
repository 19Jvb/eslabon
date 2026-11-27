import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { env } from "./helpers";

// D-06 contra la API real, solo con la publishable key. A = usuario de E2E (dueño de los datos), B = cuenta demo
// (el atacante): así la demo nunca escribe en su propia cuenta y sus datos de ejemplo no se tocan.

function apiClient() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(prefix: "DEMO" | "E2E_USER") {
  const client = apiClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: env(`${prefix}_EMAIL`),
    password: env(`${prefix}_PASSWORD`),
  });
  if (error) throw new Error(`No se pudo iniciar sesión como ${prefix}: ${error.message}`);
  return { client, userId: data.user.id };
}

/** Borra los hábitos de prueba (los check-ins caen en cascada). */
async function cleanUp(client: SupabaseClient) {
  await client.from("habits").delete().like("name", "e2e-%");
}

test.describe("aislamiento RLS entre dos usuarios", () => {
  let a: SupabaseClient;
  let b: SupabaseClient;
  let aId: string;
  let habitId: string;
  const name = `e2e-${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);

  test.beforeAll(async () => {
    ({ client: a, userId: aId } = await signIn("E2E_USER"));
    ({ client: b } = await signIn("DEMO"));
    await cleanUp(a);
    const habit = await a.from("habits").insert({ name }).select("id").single();
    if (habit.error) throw new Error(`A no pudo crear su hábito: ${habit.error.message}`);
    habitId = habit.data.id;
    const checkIn = await a.from("check_ins").insert({ habit_id: habitId, day: today });
    if (checkIn.error) throw new Error(`A no pudo marcar su hábito: ${checkIn.error.message}`);
  });

  test.afterAll(async () => {
    if (a) await cleanUp(a);
  });

  test("B no lee el hábito de A ni sus check-ins", async () => {
    const habits = await b.from("habits").select("id").eq("id", habitId);
    expect(habits.data ?? []).toEqual([]);
    const checkIns = await b.from("check_ins").select("habit_id").eq("habit_id", habitId);
    expect(checkIns.data ?? []).toEqual([]);
  });

  test("B no edita el hábito de A (0 filas) y el nombre no cambia", async () => {
    const updated = await b.from("habits").update({ name: "e2e-hackeado" }).eq("id", habitId).select("id");
    expect(updated.data ?? []).toEqual([]);
    const own = await a.from("habits").select("name").eq("id", habitId).single();
    expect(own.data?.name).toBe(name);
  });

  test("B no borra el hábito de A ni sus check-ins (0 filas) y siguen existiendo", async () => {
    const deletedHabit = await b.from("habits").delete().eq("id", habitId).select("id");
    expect(deletedHabit.data ?? []).toEqual([]);
    const deletedCheckIns = await b.from("check_ins").delete().eq("habit_id", habitId).select("habit_id");
    expect(deletedCheckIns.data ?? []).toEqual([]);
    const own = await a.from("check_ins").select("day").eq("habit_id", habitId);
    expect(own.data).toEqual([{ day: today }]);
  });

  test("B no crea hábitos a nombre de A ni marca el hábito de A", async () => {
    const habit = await b.from("habits").insert({ user_id: aId, name: `${name}-de-b` });
    expect(habit.error).not.toBeNull();
    const asB = await b.from("check_ins").insert({ habit_id: habitId, day: today });
    expect(asB.error).not.toBeNull();
    const asA = await b.from("check_ins").insert({ habit_id: habitId, user_id: aId, day: today });
    expect(asA.error).not.toBeNull();
  });

  test("sin sesión (anon) no se lee nada", async () => {
    const anon = await apiClient().from("habits").select("id").eq("id", habitId);
    expect(anon.data ?? []).toEqual([]);
  });
});

test("la cuenta demo no puede cambiar su contraseña y la original sigue funcionando", async () => {
  const { client } = await signIn("DEMO");
  const { error } = await client.auth.updateUser({ password: `e2e-${crypto.randomUUID()}` });
  try {
    expect(error, "el cambio de contraseña de la demo tuvo éxito").not.toBeNull();
  } finally {
    // Si el trigger fallara, se deja la demo como estaba.
    if (!error) await client.auth.updateUser({ password: env("DEMO_PASSWORD") });
  }
  const again = await apiClient().auth.signInWithPassword({
    email: env("DEMO_EMAIL"),
    password: env("DEMO_PASSWORD"),
  });
  expect(again.error).toBeNull();
});
