import { expect, request as playwrightRequest, test as anonymous, type Page } from "@playwright/test";
import {
  APP_URL,
  GENERIC,
  LOGIN_URL,
  alert,
  button,
  env,
  expectFitsMobile,
  expectNoSeriousA11yViolations,
  heading,
  tabTo,
  test as withSession,
} from "./helpers";

// T10: la portada pública. Solo un login en todo el archivo (el de la demo con Enter), y solo lee: la demo tiene
// los datos de ejemplo que verán los evaluadores. El resto de envíos se interceptan y no llegan al servidor.

const DEMO = "Probar con la cuenta demo";
const POINTS = ["Marca cada día", "Mira crecer tu racha", "Tus datos son solo tuyos"];
const link = (page: Page, name: string) => page.getByRole("link", { name, exact: true });
const brand = (page: Page) => page.getByRole("heading", { level: 1, name: "Eslabón", exact: true });

withSession("/ es estática: 200 sin sesión, la misma respuesta con la cookie de sesión y sin el email de nadie", async ({ session, baseURL }) => {
  const get = async (storageState?: typeof session.storageState) => {
    const context = await playwrightRequest.newContext({ baseURL, storageState });
    // Sin seguir redirecciones: si con sesión mandara a /app, se ve aquí como un 3xx.
    const response = await context.get("/", { maxRedirects: 0 });
    // Next pone un id de petición distinto en cada respuesta (self.__next_r="…"): es lo único que se normaliza.
    const body = (await response.text()).replace(/self\.__next_r="[^"]*"/g, 'self.__next_r=""');
    const result = { status: response.status(), body };
    await context.dispose();
    return result;
  };
  const anon = await get();
  const logged = await get(session.storageState);
  expect(anon.status, "sin sesión").toBe(200);
  expect(logged.status, "con la cookie de sesión").toBe(200);
  expect(logged.body, "la respuesta cambia con la cookie de sesión: la página lee la sesión").toBe(anon.body);
  for (const email of [env("E2E_USER_EMAIL"), env("DEMO_EMAIL")]) {
    expect(anon.body.includes(email), "la portada contiene el email de un usuario").toBe(false);
  }
});

anonymous.describe("portada sin sesión", () => {
  anonymous("contenido: h1 «Eslabón», el lema, una explicación de 1 o 2 frases y los 3 puntos", async ({ page }) => {
    await page.goto("/");
    await expect(brand(page)).toBeVisible();
    await expect(page.getByText("No rompas la cadena.", { exact: true })).toBeVisible();
    for (const title of POINTS) {
      await expect(page.getByRole("heading", { name: title, exact: true }), `punto «${title}»`).toBeVisible();
    }
    // La explicación: un párrafo (que no es el lema) antes del primer punto, de 1 o 2 frases.
    const first = page.getByRole("heading", { name: POINTS[0], exact: true });
    const sentences = await first.evaluate((point) =>
      [...document.querySelectorAll("p")]
        .filter((p) => p.compareDocumentPosition(point) & Node.DOCUMENT_POSITION_FOLLOWING)
        .map((p) => (p.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => text !== "No rompas la cadena." && text.length >= 20)
        .map((text) => (text.match(/[.!?…](?=\s|$)/g) ?? []).length),
    );
    expect(sentences.some((n) => n >= 1 && n <= 2), "un <p> de 1 o 2 frases antes de «Marca cada día»").toBe(true);
  });

  anonymous("<title> «Eslabón · No rompas la cadena» y una meta description en español", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Eslabón · No rompas la cadena");
    const description = page.locator('meta[name="description"]');
    await expect(description).toHaveCount(1);
    const content = ((await description.getAttribute("content")) ?? "").trim();
    expect(content.length, "meta description vacía o demasiado corta").toBeGreaterThanOrEqual(20);
    expect(content, "meta description en español").toMatch(/\b(de|del|tu|tus|cada|con|los|las|una?|día|días|hábitos?|racha)\b/i);
    expect(content).not.toMatch(/create next app/i);
  });

  anonymous("los enlaces «Entrar» → /login y «Crear cuenta» → /registro", async ({ page }) => {
    await page.goto("/");
    await link(page, "Entrar").click();
    await expect(page).toHaveURL(LOGIN_URL);
    await page.goto("/");
    await link(page, "Crear cuenta").click();
    await expect(page).toHaveURL(/\/registro\/?$/);
  });

  // D-10 sin gastar logins: el envío se retrasa y responde 500 sin llegar al servidor.
  anonymous("D-10 · doble clic en «Probar con la cuenta demo» con 500: un envío, deshabilitado mientras envía, genérico en role=alert y la portada sigue usable", async ({ page }) => {
    const sent: string[] = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && (await request.headerValue("next-action")) !== null) {
        sent.push(request.url());
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
      }
      return route.continue();
    });
    await page.goto("/");
    await button(page, DEMO).dblclick();
    await expect(button(page, DEMO)).toBeDisabled();
    await expect(alert(page, GENERIC)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(brand(page)).toBeVisible();
    await expect(button(page, DEMO)).toBeEnabled();
    expect(sent, "envíos de la Server Action").toHaveLength(1);
  });

  anonymous("D-11 · axe sin violaciones serious ni critical", async ({ page }) => {
    await page.goto("/");
    await expect(brand(page)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  // El único login del archivo: la demo, solo lectura.
  anonymous("D-11 · solo con teclado se llega a «Entrar», «Crear cuenta» y al botón demo, y Enter en el demo entra en /app como la demo", async ({ page }) => {
    for (const target of [link(page, "Entrar"), link(page, "Crear cuenta"), button(page, DEMO)]) {
      await page.goto("/");
      await tabTo(page, target);
    }
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(APP_URL);
    await expect(heading(page)).toBeVisible();
    await expect(page.getByText(env("DEMO_EMAIL")).first()).toBeVisible();
  });

  anonymous("D-12 · a 375×812 sin scroll horizontal y las 3 acciones ≥ 44×44", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expectFitsMobile(page, [DEMO]);
    for (const name of ["Entrar", "Crear cuenta"]) {
      const box = await link(page, name).boundingBox();
      expect(box, `enlace «${name}» visible`).not.toBeNull();
      expect(box!.width, `ancho de «${name}»`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `alto de «${name}»`).toBeGreaterThanOrEqual(44);
    }
  });
});
