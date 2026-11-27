import { expect, request as playwrightRequest } from "@playwright/test";
import { test } from "./helpers";

// T14b: /app lleva el email del usuario, así que ninguna respuesta suya puede quedarse en una caché compartida
// (la CDN) ni en la del navegador. Las páginas públicas siguen estáticas: su caché no cambia.

// Explícito: dentro del runner, request.newContext() hereda el storageState del fixture (la sesión).
const NO_SESSION = { cookies: [], origins: [] };

const PRIVATE_PAGES: { path: string; note: string; headers?: Record<string, string> }[] = [
  { path: "/app", note: "HTML" },
  // Sin ?_rsc, Next responde a una carga RSC con un 307 a /app?_rsc (también privado, pero no es la carga).
  { path: "/app?_rsc", note: "carga RSC", headers: { RSC: "1" } },
  { path: "/app", note: "prefetch", headers: { "Next-Router-Prefetch": "1" } },
];

test("T14b: /app sale con Cache-Control private y no-store, con sesión (200) y sin ella (307)", async ({ session, baseURL }) => {
  const withSession = await playwrightRequest.newContext({ baseURL, storageState: session.storageState });
  const anonymous = await playwrightRequest.newContext({ baseURL, storageState: NO_SESSION });
  try {
    for (const { path, note, headers } of PRIVATE_PAGES) {
      for (const [who, context, status] of [
        ["con sesión", withSession, 200],
        ["sin sesión", anonymous, 307],
      ] as const) {
        const response = await context.get(path, { headers, maxRedirects: 0 });
        const label = `${path} (${note}, ${who})`;
        expect(response.status(), label).toBe(status);
        const cacheControl = response.headers()["cache-control"] ?? "";
        expect(cacheControl, label).toContain("private");
        expect(cacheControl, label).toContain("no-store");
      }
    }
  } finally {
    await withSession.dispose();
    await anonymous.dispose();
  }
});

test("T14b: /, /login y /registro siguen sin Cache-Control private (estáticas)", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL, storageState: NO_SESSION });
  try {
    for (const path of ["/", "/login", "/registro"]) {
      const response = await anonymous.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      expect(response.headers()["cache-control"] ?? "", path).not.toContain("private");
    }
  } finally {
    await anonymous.dispose();
  }
});
