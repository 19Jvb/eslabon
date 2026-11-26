import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const APP_URL = /\/app\/?$/;
export const LOGIN_URL = /\/login\/?$/;

/** Variable de entorno obligatoria. Nunca se imprime su valor. */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (.env.local o el entorno de CI)`);
  return value;
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(APP_URL);
}

/** D-11: 0 violaciones serious o critical. Se excluye el indicador de Next en desarrollo, que no llega a producción. */
export async function expectNoSeriousA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
  const serious = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(serious).toEqual([]);
}

/** D-12: a 375×812, sin scroll horizontal y cada botón principal de 44×44 px o más. */
export async function expectFitsMobile(page: Page, buttons: string[]) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "scroll horizontal a 375 px").toBeLessThanOrEqual(clientWidth);
  for (const name of buttons) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box, `botón «${name}» visible`).not.toBeNull();
    expect(box!.width, `ancho de «${name}»`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `alto de «${name}»`).toBeGreaterThanOrEqual(44);
  }
}
