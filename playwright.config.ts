import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// En local las credenciales salen de .env.local; en CI llegan ya en el entorno.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Sin reintentos: el registro crea cuentas que no se pueden borrar y Supabase limita los logins por IP.
  retries: 0,
  forbidOnly: true,
  // En serie: los archivos comparten el usuario de E2E (rls.spec borra sus «e2e-%», auth.spec cierra su sesión)
  // y en paralelo se pisarían los datos.
  workers: 1,
  reporter: "list",
  use: { baseURL, actionTimeout: 15_000, navigationTimeout: 30_000, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // En local, un build de producción (como Vercel): `next dev` no se comporta igual (p. ej., sin Cache-Control
  // private, que cache.spec exige). Si ya hay algo en el puerto 3000, se reutiliza tal cual.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 300_000,
      },
});
