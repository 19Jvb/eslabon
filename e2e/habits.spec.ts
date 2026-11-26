import { type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Locator, type Page } from "@playwright/test";
import {
  GENERIC,
  alert,
  announced,
  button,
  cleanUp,
  expectFitsMobile,
  expectNoSeriousA11yViolations,
  failServerActions,
  field,
  item,
  openApp,
  prefix,
  seed,
  slowSubmits,
  tabTo,
  test,
  tooLong,
} from "./helpers";

// T06 con el usuario de E2E (no la demo): fixture de sesión, siembra y limpieza en helpers.ts.

async function stored(api: SupabaseClient, name: string) {
  const { data, error } = await api.from("habits").select("name, color").ilike("name", name).order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

const COLORS = ["Rojo", "Naranja", "Ámbar", "Verde", "Azul", "Violeta"];
const DUPLICATE = "Ya tienes un hábito con ese nombre.";
const colorGroup = (page: Page) =>
  page.getByRole("radiogroup", { name: "Color" }).or(page.getByRole("group", { name: "Color" })).first();
const radio = (page: Page, color: string) => colorGroup(page).getByRole("radio", { name: color, exact: true });
const dialog = (page: Page) => page.getByRole("dialog");

async function create(page: Page, name: string) {
  await field(page, "Nombre").fill(name);
  await button(page, "Crear").click();
}

/** Colores de fondo (normalizados a «r,g,b» con un canvas, porque Tailwind 4 los da en oklch) dentro de un elemento. */
function backgrounds(locator: Locator) {
  return locator.evaluate((root) => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("sin canvas");
    return [root, ...root.querySelectorAll("*")]
      .map((el) => getComputedStyle(el).backgroundColor)
      .filter((c) => c !== "transparent" && c !== "rgba(0, 0, 0, 0)")
      .map((c) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return `${r},${g},${b}`;
      });
  });
}

test.afterEach(async ({ api }) => {
  await cleanUp(api);
});

test.describe("lista", () => {
  test("los hábitos están en <ul>/<li>, del más antiguo al más reciente (no por nombre)", async ({ page, api }) => {
    const p = prefix();
    const names = [`${p}-b`, `${p}-a`, `${p}-c`];
    await seed(api, ...names.map((name) => ({ name })));
    await openApp(page);
    for (const name of names) await expect(item(page, name)).toHaveCount(1);
    const texts = await page.locator("ul > li").allInnerTexts();
    const positions = names.map((name) => texts.findIndex((t) => t.includes(name)));
    expect(positions.every((i) => i >= 0), "cada hábito es un <li> dentro de un <ul>").toBe(true);
    expect(positions, "orden por created_at, el más antiguo primero").toEqual([...positions].sort((x, y) => x - y));
  });

  test("cada hábito muestra su nombre y una muestra de su color (fondo): rojo para Rojo y azul para Azul", async ({ page, api }) => {
    const p = prefix();
    await seed(api, { name: `${p}-rojo`, color: "red" }, { name: `${p}-azul`, color: "blue" });
    await openApp(page);
    const red = await backgrounds(item(page, `${p}-rojo`));
    const blue = await backgrounds(item(page, `${p}-azul`));
    // Solo cuentan los fondos que distinguen un hábito del otro (no los de los botones comunes).
    const reddish = red.filter((c) => !blue.includes(c)).map((c) => c.split(",").map(Number));
    const bluish = blue.filter((c) => !red.includes(c)).map((c) => c.split(",").map(Number));
    expect(reddish.some(([r, g, b]) => r > g + 60 && r > b + 60), `sin muestra roja: ${red}`).toBe(true);
    expect(bluish.some(([r, g, b]) => b > r + 60 && b > g + 60), `sin muestra azul: ${blue}`).toBe(true);
  });

  test("vacío: «Aún no tienes hábitos» junto al formulario; al crear uno, desaparece", async ({ page, api }) => {
    await cleanUp(api);
    expect(await stored(api, "%"), "la cuenta E2E tiene hábitos que no son e2e-").toEqual([]);
    await openApp(page);
    await expect(page.getByText("Aún no tienes hábitos")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nuevo hábito" })).toBeVisible();
    await expect(field(page, "Nombre")).toBeVisible();
    const name = `${prefix()}-primero`;
    await create(page, name);
    await expect(item(page, name)).toBeVisible();
    await expect(page.getByText("Aún no tienes hábitos")).toBeHidden();
  });
});

test.describe("crear", () => {
  test("«Nuevo hábito» con «Nombre», radios «Color» (Rojo…Violeta, Verde por defecto) y «Crear»", async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole("heading", { name: "Nuevo hábito" })).toBeVisible();
    await expect(field(page, "Nombre")).toBeVisible();
    const radios = colorGroup(page).getByRole("radio");
    await expect(radios).toHaveCount(COLORS.length);
    for (const [i, color] of COLORS.entries()) await expect(radios.nth(i)).toHaveAccessibleName(color);
    await expect(radio(page, "Verde")).toBeChecked();
    await expect(button(page, "Crear")).toBeVisible();
  });

  test("crear con Azul: el campo se vacía, aparece en la lista, se guarda sin espacios sobrantes y sigue al recargar", async ({ page, api }) => {
    const name = `${prefix()}-azul`;
    await openApp(page);
    await radio(page, "Azul").check();
    await create(page, `  ${name}  `);
    await expect(field(page, "Nombre")).toHaveValue("");
    await expect(item(page, name)).toBeVisible();
    expect(await stored(api, name)).toEqual([{ name, color: "blue" }]);
    await page.reload();
    await expect(item(page, name)).toBeVisible();
  });

  test("vacío o solo espacios → «Escribe un nombre» (role=alert) y no se crea nada", async ({ page, api }) => {
    await openApp(page);
    await create(page, "");
    await expect(alert(page, "Escribe un nombre")).toBeVisible();
    await page.reload();
    await create(page, "   ");
    await expect(alert(page, "Escribe un nombre")).toBeVisible();
    expect(await stored(api, "%")).toEqual([]);
  });

  test("61 caracteres → «Máximo 60 caracteres» (role=alert); 60 sí se acepta", async ({ page, api }) => {
    const p = prefix();
    await openApp(page);
    await create(page, tooLong(p));
    await expect(alert(page, "Máximo 60 caracteres")).toBeVisible();
    expect(await stored(api, `${p}%`)).toEqual([]);
    const sixty = tooLong(p).slice(0, 60);
    await create(page, sixty);
    await expect(item(page, sixty)).toBeVisible();
  });

  test("nombre repetido, aunque cambien mayúsculas → «Ya tienes un hábito con ese nombre.» y no se duplica", async ({ page, api }) => {
    const name = `${prefix()}-correr`;
    await seed(api, { name });
    await openApp(page);
    await create(page, name.toUpperCase());
    await expect(alert(page, DUPLICATE)).toBeVisible();
    expect(await stored(api, name)).toEqual([{ name, color: "green" }]);
    await page.reload();
    await create(page, name);
    await expect(alert(page, DUPLICATE)).toBeVisible();
    await expect(item(page, name)).toHaveCount(1);
  });

  test("D-10: doble clic en «Crear» → un solo envío, botón deshabilitado mientras envía y un solo hábito", async ({ page, api }) => {
    const name = `${prefix()}-doble`;
    await openApp(page);
    const sent = await slowSubmits(page);
    await field(page, "Nombre").fill(name);
    await button(page, "Crear").dblclick();
    await expect(button(page, "Crear")).toBeDisabled();
    await expect(item(page, name)).toHaveCount(1);
    await expect(button(page, "Crear")).toBeEnabled();
    await expect(alert(page, DUPLICATE)).toHaveCount(0);
    expect(sent).toHaveLength(1);
    expect(await stored(api, name)).toHaveLength(1);
  });

  test("D-10: «Crear» con 500 → genérico anunciado, el formulario conserva lo escrito y no queda un hábito fantasma", async ({ page }) => {
    const name = `${prefix()}-fallo`;
    await openApp(page);
    await failServerActions(page);
    await create(page, name);
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(field(page, "Nombre")).toHaveValue(name);
    await expect(item(page, name)).toHaveCount(0);
    await expect(button(page, "Crear")).toBeEnabled();
  });
});

test.describe("renombrar", () => {
  test("«Renombrar <nombre>» → «Nuevo nombre» relleno, «Guardar» y «Cancelar»; Guardar renombra y persiste", async ({ page, api }) => {
    const p = prefix();
    const [old, renamed] = [`${p}-viejo`, `${p}-nuevo`];
    await seed(api, { name: old });
    await openApp(page);
    await button(page, `Renombrar ${old}`).click();
    await expect(field(page, "Nuevo nombre")).toHaveValue(old);
    await expect(button(page, "Guardar")).toBeVisible();
    await expect(button(page, "Cancelar")).toBeVisible();
    await field(page, "Nuevo nombre").fill(renamed);
    await button(page, "Guardar").click();
    await expect(item(page, renamed)).toBeVisible();
    await expect(item(page, old)).toHaveCount(0);
    await expect(field(page, "Nuevo nombre")).toBeHidden();
    expect(await stored(api, `${p}%`)).toEqual([{ name: renamed, color: "green" }]);
    await page.reload();
    await expect(item(page, renamed)).toBeVisible();
  });

  test("Escape y «Cancelar» cierran el formulario sin cambiar el nombre", async ({ page, api }) => {
    const name = `${prefix()}-quieto`;
    await seed(api, { name });
    await openApp(page);
    await button(page, `Renombrar ${name}`).click();
    await field(page, "Nuevo nombre").fill(`${name}-descartado`);
    await page.keyboard.press("Escape");
    await expect(field(page, "Nuevo nombre")).toBeHidden();
    await expect(item(page, name)).toBeVisible();
    await button(page, `Renombrar ${name}`).click();
    await expect(field(page, "Nuevo nombre")).toHaveValue(name);
    await button(page, "Cancelar").click();
    await expect(field(page, "Nuevo nombre")).toBeHidden();
    expect(await stored(api, `${name}%`)).toEqual([{ name, color: "green" }]);
  });

  test("mismos errores: «Escribe un nombre», «Máximo 60 caracteres» y «Ya tienes un hábito con ese nombre.»", async ({ page, api }) => {
    const p = prefix();
    const [name, other] = [`${p}-uno`, `${p}-otro`];
    await seed(api, { name }, { name: other });
    await openApp(page);
    await button(page, `Renombrar ${name}`).click();
    for (const [value, message] of [
      ["", "Escribe un nombre"],
      [tooLong(p), "Máximo 60 caracteres"],
      ["   ", "Escribe un nombre"],
      [other.toUpperCase(), DUPLICATE],
    ]) {
      await field(page, "Nuevo nombre").fill(value);
      await button(page, "Guardar").click();
      await expect(alert(page, message), `«${value}» → «${message}»`).toBeVisible();
    }
    expect(await stored(api, `${p}%`)).toEqual([
      { name, color: "green" },
      { name: other, color: "green" },
    ]);
  });

  test("D-10: «Guardar» con 500 → genérico anunciado y la lista mantiene el nombre anterior", async ({ page, api }) => {
    const name = `${prefix()}-sigue`;
    await seed(api, { name });
    await openApp(page);
    await failServerActions(page);
    await button(page, `Renombrar ${name}`).click();
    await field(page, "Nuevo nombre").fill(`${name}-fantasma`);
    await button(page, "Guardar").click();
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(item(page, `${name}-fantasma`)).toHaveCount(0);
    // Vale tanto cerrar el formulario como dejarlo abierto con lo escrito; al cancelar, el nombre es el de antes.
    if (await field(page, "Nuevo nombre").isVisible()) await button(page, "Cancelar").click();
    await expect(item(page, name)).toBeVisible();
  });
});

test.describe("borrar", () => {
  test("«Borrar <nombre>» → diálogo con el texto, «Sí, borrar» y «Cancelar»; el foco entra y vuelve; Sí, borrar lo quita", async ({ page, api }) => {
    const name = `${prefix()}-borrable`;
    await seed(api, { name });
    await openApp(page);
    const trigger = button(page, `Borrar ${name}`);
    for (const close of ["Cancelar", "Escape"]) {
      await trigger.click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toContainText(`¿Borrar «${name}»? Se perderá su historial.`);
      await expect(dialog(page).getByRole("button", { name: "Sí, borrar", exact: true })).toBeVisible();
      expect(await dialog(page).evaluate((d) => d.contains(document.activeElement)), "el foco entra en el diálogo").toBe(true);
      if (close === "Escape") await page.keyboard.press("Escape");
      else await dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(trigger, `tras ${close}, el foco vuelve a «Borrar ${name}»`).toBeFocused();
      await expect(item(page, name)).toBeVisible();
    }
    await trigger.click();
    await dialog(page).getByRole("button", { name: "Sí, borrar", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(item(page, name)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body), {
        message: "tras borrar, el foco no se pierde en <body>",
      })
      .toBe(true);
    expect(await stored(api, name)).toEqual([]);
  });

  test("D-10: «Sí, borrar» con 500 → genérico anunciado y el hábito sigue en la lista", async ({ page, api }) => {
    const name = `${prefix()}-superviviente`;
    await seed(api, { name });
    await openApp(page);
    await failServerActions(page);
    await button(page, `Borrar ${name}`).click();
    await dialog(page).getByRole("button", { name: "Sí, borrar", exact: true }).click();
    await expect(announced(page, GENERIC)).toBeVisible();
    await expect(item(page, name)).toBeVisible();
  });
});

test.describe("accesibilidad y móvil", () => {
  test("D-11: axe sin serious ni critical con hábitos, con «Renombrar» abierto y con el diálogo de borrar", async ({ page, api }) => {
    const p = prefix();
    await seed(api, { name: `${p}-uno`, color: "red" }, { name: `${p}-dos`, color: "violet" });
    await openApp(page);
    await expect(item(page, `${p}-dos`)).toBeVisible();
    await test.step("con hábitos", () => expectNoSeriousA11yViolations(page));
    await button(page, `Renombrar ${p}-uno`).click();
    await expect(field(page, "Nuevo nombre")).toBeVisible();
    await test.step("con el formulario de renombrar", () => expectNoSeriousA11yViolations(page));
    await button(page, "Cancelar").click();
    await button(page, `Borrar ${p}-uno`).click();
    await expect(dialog(page)).toBeVisible();
    await test.step("con el diálogo de borrar", () => expectNoSeriousA11yViolations(page));
  });

  test("D-11: crear un hábito solo con teclado (Tab, flechas en los radios y Enter), con el foco visible", async ({ page, api }) => {
    const name = `${prefix()}-teclado`;
    await openApp(page);
    await tabTo(page, field(page, "Nombre"));
    await page.keyboard.type(name);
    const unfocused = await colorGroup(page).screenshot();
    // El radio puede estar oculto y pintar el foco en su etiqueta: se compara la imagen del grupo.
    await tabTo(page, radio(page, "Verde"), { checkRing: false });
    expect((await colorGroup(page).screenshot()).equals(unfocused), "el foco en los radios no se ve").toBe(false);
    await page.keyboard.press("ArrowRight");
    await expect(radio(page, "Azul")).toBeChecked();
    await tabTo(page, button(page, "Crear"));
    await page.keyboard.press("Enter");
    await expect(item(page, name)).toBeVisible();
    expect(await stored(api, name)).toEqual([{ name, color: "blue" }]);
  });

  test("D-12: a 375×812, con un nombre de 60 caracteres sin espacios, sin scroll horizontal y botones ≥ 44×44", async ({ page, api }) => {
    const name = tooLong(prefix()).slice(0, 60);
    await seed(api, { name });
    await page.setViewportSize({ width: 375, height: 812 });
    await openApp(page);
    await expect(item(page, name)).toBeVisible();
    await expectFitsMobile(page, ["Crear", `Renombrar ${name}`, `Borrar ${name}`]);
    await button(page, `Renombrar ${name}`).click();
    await expect(field(page, "Nuevo nombre")).toBeVisible();
    await expectFitsMobile(page, ["Guardar", "Cancelar"]);
    await button(page, "Cancelar").click();
    await button(page, `Borrar ${name}`).click();
    await expect(dialog(page)).toBeVisible();
    await expectFitsMobile(page, ["Sí, borrar", "Cancelar"]);
  });
});
