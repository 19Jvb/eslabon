import { expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { openApp, test } from "./helpers";

// T23: la app instalable. El manifest (convención src/app/manifest.ts de Next) en /manifest.webmanifest, sus iconos
// PNG, el apple-touch-icon y el theme-color en el HTML; nada de eso pasa por el login. Solo lee: no crea datos.

const MANIFEST = "/manifest.webmanifest";
const NO_SESSION = { cookies: [], origins: [] };
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

type Icon = { src: string; sizes?: string; type?: string; purpose?: string };
type Manifest = Record<string, unknown> & { icons?: Icon[] };

/** Ancho y alto reales de un PNG: la firma y, justo detrás, el chunk IHDR (ancho y alto en uint32 big-endian). */
function pngSize(body: Buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(body.subarray(0, 8).equals(signature), "firma PNG").toBe(true);
  expect(body.subarray(12, 16).toString("latin1"), "el primer chunk es IHDR").toBe("IHDR");
  return `${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`;
}

async function getManifest(request: APIRequestContext) {
  const response = await request.get(MANIFEST, { maxRedirects: 0 });
  expect(response.status(), `${MANIFEST}: estado HTTP`).toBe(200);
  expect(response.headers()["content-type"] ?? "", `${MANIFEST}: content-type`).toMatch(/json/);
  return (await response.json()) as Manifest;
}

/** El icono responde 200 image/png (sin redirigir) y mide lo que dice `size` («192x192»). */
async function expectPng(request: APIRequestContext, src: string, size: string) {
  const response = await request.get(src, { maxRedirects: 0 });
  expect(response.status(), `${src}: estado HTTP`).toBe(200);
  expect(response.headers()["content-type"] ?? "", `${src}: content-type`).toMatch(/^image\/png\b/);
  expect(pngSize(await response.body()), `${src}: tamaño real`).toBe(size);
}

/** Lo que enlaza el <head> de la página: el manifest, los theme-color y el apple-touch-icon (href y sizes). */
const readHead = (page: Page) =>
  page.evaluate(() => {
    const links = (rel: string) => [...document.querySelectorAll<HTMLLinkElement>(`link[rel~="${rel}"]`)];
    return {
      manifest: links("manifest").map((l) => new URL(l.href).pathname),
      themeColors: [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content.toLowerCase()),
      apple: links("apple-touch-icon").map((l) => ({ href: new URL(l.href).pathname + new URL(l.href).search, sizes: l.getAttribute("sizes") })),
    };
  });

const purposes = (icon: Icon) => (icon.purpose ?? "any").split(/\s+/);
const find = (icons: Icon[], size: string, purpose: "any" | "maskable") =>
  icons.filter((i) => i.sizes === size && i.type === "image/png" && purposes(i).join(" ") === purpose);

test.describe("manifest", () => {
  test("/manifest.webmanifest: 200 con un JSON con name y short_name «Eslabón», description, lang es, start_url /app, display standalone, colores hex e iconos PNG 192 y 512 (any) y 512 (maskable)", async ({ baseURL }) => {
    const request = await playwrightRequest.newContext({ baseURL, storageState: NO_SESSION });
    try {
      const m = await getManifest(request);
      expect(m.name, "name").toBe("Eslabón");
      expect(m.short_name, "short_name").toBe("Eslabón");
      expect(typeof m.description === "string" && m.description.trim().length > 0, "description no vacía").toBe(true);
      expect(m.lang, "lang").toBe("es");
      expect(m.start_url, "start_url").toBe("/app");
      expect(m.display, "display").toBe("standalone");
      expect(String(m.background_color), "background_color en hex").toMatch(HEX);
      expect(String(m.theme_color), "theme_color en hex").toMatch(HEX);
      const icons = m.icons ?? [];
      expect(find(icons, "192x192", "any"), "un icono PNG 192x192 purpose any").toHaveLength(1);
      expect(find(icons, "512x512", "any"), "un icono PNG 512x512 purpose any").toHaveLength(1);
      expect(find(icons, "512x512", "maskable"), "un icono PNG 512x512 purpose maskable").toHaveLength(1);
    } finally {
      await request.dispose();
    }
  });

  test("cada icono del manifest responde 200 image/png y su tamaño real (IHDR) es el declarado", async ({ baseURL }) => {
    const request = await playwrightRequest.newContext({ baseURL, storageState: NO_SESSION });
    try {
      const icons = (await getManifest(request)).icons ?? [];
      expect(icons.length, "el manifest tiene iconos").toBeGreaterThanOrEqual(3);
      for (const icon of icons) {
        expect(icon.sizes, `${icon.src}: sizes «AxB»`).toMatch(/^\d+x\d+$/);
        await expectPng(request, new URL(icon.src, new URL(MANIFEST, baseURL)).toString(), icon.sizes!);
      }
    } finally {
      await request.dispose();
    }
  });
});

test.describe("el HTML enlaza el manifest", () => {
  test("/, /login y /app: <link rel=manifest> a /manifest.webmanifest, <meta name=theme-color> con el theme_color del manifest y un apple-touch-icon de 180×180 (200 image/png, tamaño real)", async ({ page, browser, baseURL }) => {
    const request = await playwrightRequest.newContext({ baseURL, storageState: NO_SESSION });
    const anonymous = await browser.newContext({ baseURL, storageState: NO_SESSION });
    try {
      const theme = String((await getManifest(request)).theme_color).toLowerCase();
      const anonPage = await anonymous.newPage();
      const pages: [string, Page][] = [
        ["/", anonPage],
        ["/login", anonPage],
        ["/app", page],
      ];
      for (const [path, target] of pages) {
        if (path === "/app") await openApp(target);
        else expect((await target.goto(path))?.status(), `${path}: estado HTTP`).toBe(200);
        const head = await readHead(target);
        expect(head.manifest, `${path}: <link rel="manifest">`).toEqual([MANIFEST]);
        expect(head.themeColors.length, `${path}: <meta name="theme-color">`).toBeGreaterThan(0);
        expect(head.themeColors, `${path}: theme-color = theme_color del manifest (${theme})`).toContain(theme);
        expect(head.apple.length, `${path}: <link rel="apple-touch-icon">`).toBeGreaterThan(0);
        for (const { href, sizes } of head.apple) {
          if (sizes !== null) expect(sizes, `${path}: sizes del apple-touch-icon`).toBe("180x180");
          await expectPng(request, href, "180x180");
        }
      }
    } finally {
      await anonymous.close();
      await request.dispose();
    }
  });

  test("sin sesión, el proxy no redirige el manifest, sus iconos ni el apple-touch-icon: 200, no 307 a /login", async ({ browser, baseURL }) => {
    const request = await playwrightRequest.newContext({ baseURL, storageState: NO_SESSION });
    const anonymous = await browser.newContext({ baseURL, storageState: NO_SESSION });
    try {
      const manifest = await request.get(MANIFEST, { maxRedirects: 0 });
      expect(manifest.status(), `${MANIFEST} sin sesión`).toBe(200);
      const icons = ((await manifest.json()) as Manifest).icons ?? [];
      const page = await anonymous.newPage();
      await page.goto("/");
      const apple = (await readHead(page)).apple.map((a) => a.href);
      const all = [...icons.map((i) => new URL(i.src, new URL(MANIFEST, baseURL)).pathname), ...apple];
      expect(all.length, "iconos que comprobar").toBeGreaterThanOrEqual(4);
      for (const path of all) {
        const response = await request.get(path, { maxRedirects: 0 });
        expect(response.status(), `${path} sin sesión (no 307 a /login)`).toBe(200);
      }
    } finally {
      await anonymous.close();
      await request.dispose();
    }
  });
});
