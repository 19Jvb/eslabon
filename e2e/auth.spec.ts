import { expect, test } from "@playwright/test";
import {
  APP_URL,
  GENERIC,
  LOGIN_URL,
  announced,
  button,
  env,
  expectFitsMobile,
  expectNoSeriousA11yViolations,
  failServerActions,
  field,
  heading,
  login,
  slowSubmits,
  tabTo,
} from "./helpers";

// Nota: los logins de este archivo son pocos a propósito (Supabase limita los inicios de sesión por IP).

test.describe("páginas de acceso", () => {
  test("/login: Email, Contraseña, «Entrar», «Probar con la cuenta demo» y título «Entrar · Eslabón»", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle("Entrar · Eslabón");
    await expect(field(page, "Email")).toBeVisible();
    await expect(field(page, "Contraseña")).toHaveAttribute("type", "password");
    await expect(button(page, "Entrar")).toBeVisible();
    await expect(button(page, "Probar con la cuenta demo")).toBeVisible();
  });

  test("/registro: Email, Contraseña, «Crear cuenta», «Probar con la cuenta demo» y título «Crear cuenta · Eslabón»", async ({ page }) => {
    await page.goto("/registro");
    await expect(page).toHaveTitle("Crear cuenta · Eslabón");
    await expect(field(page, "Email")).toBeVisible();
    await expect(field(page, "Contraseña")).toHaveAttribute("type", "password");
    await expect(button(page, "Crear cuenta")).toBeVisible();
    await expect(button(page, "Probar con la cuenta demo")).toBeVisible();
  });

  test("/app sin sesión redirige a /login (sin ?next=)", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(LOGIN_URL);
  });

  for (const [path, buttons] of [
    ["/login", ["Entrar", "Probar con la cuenta demo"]],
    ["/registro", ["Crear cuenta", "Probar con la cuenta demo"]],
  ] as const) {
    test(`${path}: axe sin violaciones serious ni critical`, async ({ page }) => {
      await page.goto(path);
      await expect(button(page, "Probar con la cuenta demo")).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    });

    test(`${path}: a 375×812 sin scroll horizontal y botones principales ≥ 44×44`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(path);
      await expectFitsMobile(page, [...buttons]);
    });
  }
});

test.describe("login", () => {
  test("contraseña incorrecta: «Email o contraseña incorrectos», anunciado, y sigue en /login", async ({ page }) => {
    await page.goto("/login");
    await field(page, "Email").fill(env("E2E_USER_EMAIL"));
    await field(page, "Contraseña").fill("contraseña-incorrecta-123");
    await button(page, "Entrar").click();
    await expect(announced(page, "Email o contraseña incorrectos")).toBeVisible();
    await expect(page).toHaveURL(LOGIN_URL);
  });

  test("solo con teclado: entra en /app con h1 «Tus hábitos», el email visible y título «Tus hábitos · Eslabón»", async ({ page }) => {
    const email = env("E2E_USER_EMAIL");
    await page.goto("/login");
    await tabTo(page, field(page, "Email"));
    await page.keyboard.type(email);
    await tabTo(page, field(page, "Contraseña"));
    await page.keyboard.type(env("E2E_USER_PASSWORD"));
    await tabTo(page, button(page, "Entrar"));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(APP_URL);
    await expect(heading(page)).toBeVisible();
    await expect(page.getByText(email).first()).toBeVisible();
    await expect(page).toHaveTitle("Tus hábitos · Eslabón");
  });

  test("doble clic en «Entrar»: un solo envío, botón deshabilitado mientras envía, y ?next= se ignora (siempre /app)", async ({ page }) => {
    const sent = await slowSubmits(page);
    await page.goto("/login?next=https%3A%2F%2Fexample.com%2F");
    await field(page, "Email").fill(env("E2E_USER_EMAIL"));
    await field(page, "Contraseña").fill(env("E2E_USER_PASSWORD"));
    await button(page, "Entrar").dblclick();
    await expect(button(page, "Entrar")).toBeDisabled();
    await expect(page).toHaveURL(APP_URL);
    expect(sent).toHaveLength(1);
  });

  test("con sesión, /login y /registro → /app; «Cerrar sesión» → /login y /app vuelve a pedir sesión", async ({ page }) => {
    await login(page, env("E2E_USER_EMAIL"), env("E2E_USER_PASSWORD"));
    await page.goto("/login");
    await expect(page).toHaveURL(APP_URL);
    await page.goto("/registro");
    await expect(page).toHaveURL(APP_URL);
    await button(page, "Cerrar sesión").click();
    await expect(page).toHaveURL(LOGIN_URL);
    await page.goto("/app");
    await expect(page).toHaveURL(LOGIN_URL);
  });

  test("/app: axe sin violaciones serious ni critical y, a 375×812, sin scroll horizontal y «Cerrar sesión» ≥ 44×44", async ({ page }) => {
    await login(page, env("E2E_USER_EMAIL"), env("E2E_USER_PASSWORD"));
    await expect(heading(page)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await expect(heading(page)).toBeVisible();
    await expectFitsMobile(page, ["Cerrar sesión"]);
  });
});

test.describe("cuenta demo", () => {
  for (const path of ["/login", "/registro"]) {
    test(`«Probar con la cuenta demo» en ${path} entra en /app como la demo`, async ({ page }) => {
      await page.goto(path);
      await button(page, "Probar con la cuenta demo").click();
      await expect(page).toHaveURL(APP_URL);
      await expect(heading(page)).toBeVisible();
      await expect(page.getByText(env("DEMO_EMAIL")).first()).toBeVisible();
    });
  }
});

test.describe("registro", () => {
  test("contraseña de menos de 8: «La contraseña debe tener al menos 8 caracteres» y sigue en /registro", async ({ page }) => {
    await page.goto("/registro");
    await field(page, "Email").fill(`e2e+corta-${Date.now()}@example.com`);
    await field(page, "Contraseña").fill("1234567");
    await button(page, "Crear cuenta").click();
    await expect(announced(page, "La contraseña debe tener al menos 8 caracteres")).toBeVisible();
    await expect(page).toHaveURL(/\/registro\/?$/);
  });

  test("email ya registrado: «Ya existe una cuenta con ese email»", async ({ page }) => {
    await page.goto("/registro");
    await field(page, "Email").fill(env("E2E_USER_EMAIL"));
    await field(page, "Contraseña").fill("una-contraseña-larga-123");
    await button(page, "Crear cuenta").click();
    await expect(announced(page, "Ya existe una cuenta con ese email")).toBeVisible();
    await expect(page).toHaveURL(/\/registro\/?$/);
  });

  // Crea 1 cuenta por ejecución, que no se puede borrar sin la service_role.
  test("registro correcto con doble clic: un solo envío, botón deshabilitado y entra directo en /app con su email", async ({ page }) => {
    const email = `e2e+${Date.now()}@example.com`;
    const sent = await slowSubmits(page);
    await page.goto("/registro");
    await field(page, "Email").fill(email);
    await field(page, "Contraseña").fill(`e2e-${crypto.randomUUID()}`);
    await button(page, "Crear cuenta").dblclick();
    await expect(button(page, "Crear cuenta")).toBeDisabled();
    await expect(page).toHaveURL(APP_URL);
    await expect(heading(page)).toBeVisible();
    await expect(page.getByText(email).first()).toBeVisible();
    expect(sent).toHaveLength(1);
  });
});

// D-10 (añadido en la revisión de T05 r1): si la Server Action falla (500), la página no se pierde.
// Ningún envío llega al servidor, así que no gasta logins.
test.describe("fallo del servidor (D-10)", () => {
  for (const [path, submit] of [
    ["/login", "Entrar"],
    ["/registro", "Crear cuenta"],
    ["/login", "Probar con la cuenta demo"],
  ] as const) {
    test(`${path} · «${submit}» con 500: genérico anunciado y el formulario sigue usable`, async ({ page }) => {
      await failServerActions(page);
      await page.goto(path);
      await field(page, "Email").fill("e2e-fallo@example.com");
      await field(page, "Contraseña").fill("una-contraseña-larga-123");
      await button(page, submit).click();
      await expect(announced(page, GENERIC)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${path}/?$`));
      await expect(button(page, submit)).toBeEnabled();
      await expect(field(page, "Email")).toBeVisible();
    });
  }

  test("/app · «Cerrar sesión» con 500: genérico anunciado y se sigue en /app", async ({ page }) => {
    await login(page, env("E2E_USER_EMAIL"), env("E2E_USER_PASSWORD"));
    await expect(heading(page)).toBeVisible();
    await failServerActions(page);
    await button(page, "Cerrar sesión").click();
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(page).toHaveURL(APP_URL);
    await expect(heading(page)).toBeVisible();
    await expect(button(page, "Cerrar sesión")).toBeEnabled();
  });
});
