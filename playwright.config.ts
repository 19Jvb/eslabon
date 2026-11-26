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
  reporter: "list",
  use: { baseURL, actionTimeout: 15_000, navigationTimeout: 30_000, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
