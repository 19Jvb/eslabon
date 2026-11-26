import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

export const APP_URL = /\/app\/?$/;
export const LOGIN_URL = /\/login\/?$/;
export const GENERIC = "No se pudo completar. Inténtalo de nuevo.";

export const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
export const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
export const heading = (page: Page) => page.getByRole("heading", { level: 1, name: "Tus hábitos" });
/** D-11: el mensaje tiene que estar en una región anunciada (role="alert" o aria-live). */
export const announced = (page: Page, text: string) =>
  page.locator('[role="alert"], [aria-live]').filter({ hasText: text });

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

/**
 * D-10: retrasa cada envío (Server Action con cabecera next-action, o POST directo a GoTrue)
 * para que se vea el estado de envío, y devuelve la lista de envíos que salieron.
 */
export async function slowSubmits(page: Page) {
  const sent: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const isSubmit =
      request.method() === "POST" &&
      ((await request.headerValue("next-action")) !== null ||
        /\/auth\/v1\/(token|signup)/.test(request.url()));
    if (isSubmit) {
      sent.push(request.url());
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    await route.continue();
  });
  return sent;
}

/** D-10: cada Server Action responde 500 sin llegar al servidor. */
export async function failServerActions(page: Page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && (await request.headerValue("next-action")) !== null) {
      return route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
    }
    return route.continue();
  });
}

/** D-11: llega al elemento solo con Tab y, si se pide, comprueba que el foco se ve (outline o ring). */
export async function tabTo(page: Page, target: Locator, { checkRing = true } = {}) {
  await expect(target).toBeVisible();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) {
      if (!checkRing) return;
      const focusVisible = await target.evaluate((el) => {
        const s = getComputedStyle(el);
        return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
      });
      expect(focusVisible, "el foco no se ve (ni outline ni ring)").toBe(true);
      return;
    }
  }
  throw new Error("No se llega al elemento con Tab");
}
