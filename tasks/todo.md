# Tareas: Eslabón

> Ciclo de cada tarea (CLAUDE.md): [en las tareas con UI, Testing escribe primero los E2E] → Develop implementa → `npm run check` en verde → Testing revisa contra las directrices D-xx → informe `docs/revisiones/Txx-rN.md` → se repite hasta que sale APROBADO → commit. Todas las tareas incluyen D-01 (`npm run check` en verde) en su verificación.

## Fase 0: Equipo de agentes
- [x] **T00: Crear el equipo de agentes** (Orquestador; los subagentes aún no existen)
  - Aceptación: `git init` (rama `main`). `.gitignore` que excluye `.env*` salvo `.env.example`, y `.gitattributes` con LF. Existen `CLAUDE.md` (Orquestador), `.claude/agents/develop.md` y `.claude/agents/testing.md` (directrices D-01…D-16 con sus comandos). `docs/revisiones/README.md` (índice de las revisiones).
  - Verificar: Claude Code lista los agentes `develop` y `testing`. Los comandos de D-03 y D-04 detectan una trampa y una clave falsas en archivos nuevos (prueba en un repo temporal).

## Fase 1: Fundación
- [x] **T01: Scaffold de Next.js 16** (M, sin UI propia)
  - create-next-app solo acepta una carpeta casi vacía y crea `AGENTS.md` por defecto. Por eso se genera aparte y se mueve:
    `npx create-next-app@16.4.6 tmp-app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-agents-md --no-agent-feedback --yes`
    (comprobado por el Orquestador: con esos flags no pide nada ni genera `AGENTS.md`).
    Después: se borra `tmp-app/.git` (lo crea el scaffold; nunca se mueve), se mueve el resto a la raíz, se fusiona su `.gitignore` con el nuestro (sin perder ninguna línea del nuestro) y se sustituye su `README.md` por el nuestro (T15). Al final se borra `tmp-app/`.
  - Dependencias (las de SPEC §4): `@supabase/ssr`, `@supabase/supabase-js`, `zod`. De desarrollo: `vitest`, `@playwright/test`, `@axe-core/playwright`.
  - Scripts: `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`, `"check": "eslint --max-warnings=0 && tsc --noEmit && vitest run && next build"` y `"e2e": "playwright test"`.
  - `.env.example` con las 6 variables de `develop.md`, sin valores. La página de bienvenida del scaffold, sustituida por una página mínima de «Eslabón» (se diseña en T10).
  - Aceptación: `npm run check` → exit 0 con al menos un test real de Vitest. `npm run dev` sirve `/` con 200. No existen ni `AGENTS.md` ni `tmp-app/`.
- [ ] **T02: CI en GitHub Actions** (XS)
  - Aceptación: `.github/workflows/ci.yml` ejecuta `npm ci && npm run check` en cada push y PR, con Node 22. El build usa valores ficticios que no se parecen a claves reales (`NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy`), para no disparar D-04.
  - Verificar: el YAML es válido. En verde tras el primer push (T12).
- [ ] **T03: Lógica pura de fechas y rachas, con TDD** (M, sin UI)
  - Aceptación:
    - `src/lib/dates.ts`: `todayIn(tz)`, `addDays`, `isEditableDay(day, today)` (de hoy a hoy−6).
    - `src/lib/streak.ts`: `currentStreak` (si hoy no está marcado, la racha que viene de ayer sigue viva), `bestStreak`, `completionRate(days, today, 30)` y `heatmapWeeks(days, today, 12)`.
  - Verificar: tests de fin de mes y de año, 29 de febrero, cambio de horario en Europe/Madrid (último domingo de marzo y de octubre), conjunto vacío y entrada desordenada o duplicada.

### Checkpoint A: el humano revisa los informes y las rondas de rechazo

## Fase 2: Supabase y Auth
- [ ] **T04: Esquema, RLS y clientes de Supabase** (M, sin UI) · manual: el humano crea el proyecto y ejecuta el SQL
  - Aceptación:
    - `supabase/migrations/0001_init.sql`: las tablas, restricciones y RLS de SPEC §7.
    - **Protección de la cuenta demo:** un trigger `before update on auth.users` que lanza un error si cambia `email` o `encrypted_password` de un usuario con `raw_app_meta_data->>'demo' = 'true'`. La marca se pone a mano en el SQL Editor, así el email no queda escrito en el repo.
    - Clientes de servidor y navegador con `@supabase/ssr`. Refresco de sesión en `proxy.ts`.
  - Verificar: el SQL se ejecuta sin errores. Sin sesión, una consulta con la publishable key devuelve 0 filas.
- [ ] **T05: Auth: registro, login, logout y acceso demo** (M, con UI) · manual: el humano crea el usuario demo (lo marca como demo) y el de E2E. El Orquestador ejecuta `npx playwright install chromium`
  - Aceptación (con los nombres visibles exactos que usarán los E2E):
    - `/login` tiene «Email», «Contraseña» y el botón «Entrar». `/registro`, «Email», «Contraseña» y «Crear cuenta». Ambas, el botón «Probar con la cuenta demo».
    - Errores en español: «Email o contraseña incorrectos», «Ya existe una cuenta con ese email», «La contraseña debe tener al menos 8 caracteres».
    - `/app` sin sesión → `/login`. `/login` con sesión → `/app`. Botón «Cerrar sesión».
  - Verificar: E2E de auth, RLS (D-06), cuenta demo protegida (D-06), axe (D-11) y 375 px (D-12).

### Checkpoint B: login demo funcionando en local

## Fase 3: Funcionalidades (todas con UI: Testing escribe primero los E2E)
- [ ] **T06: Hábitos: crear, listar, renombrar y borrar** (M): SPEC F3. Nombres visibles: «Nuevo hábito», «Nombre», «Crear», «Renombrar», «Borrar» y la confirmación «Sí, borrar».
- [ ] **T07: Marcar y desmarcar días** (hoy y los 6 anteriores), cookie de zona horaria y UI optimista (M): SPEC F4 y D-10.
- [ ] **T08: Estadísticas y mapa de calor de 12 semanas** (M): SPEC F5.
- [ ] **T09: «Cargar datos de ejemplo», idempotente** (S): SPEC F6.
- [ ] **T10: Landing pública con el CTA de la demo** (S): SPEC F1.
- [ ] **T11: Pulido visual (identidad de cadena y eslabones) y accesibilidad** (M): D-11 y D-12 en todas las páginas.

### Checkpoint C: flujo completo en local; el humano lo prueba

## Fase 4: Publicación
- [ ] **T12: Repo en GitHub y despliegue en Vercel** · manual guiado
  - Aceptación: repo público `19Jvb/eslabon` con el CI en verde. Producción con las variables en Vercel y Deployment Protection desactivada.
  - Verificar: `curl -sI <prod>` sin cookies → 200 (no 401 ni redirección a vercel.com), y la ventana de incógnito del humano abre la app.
- [ ] **T13: Keep-alive de Supabase** (XS) · manual: secrets de GitHub
  - Aceptación: un workflow programado (cada 3 días, más `workflow_dispatch`) que hace una consulta ligera con la publishable key.
  - Verificar: lanzado a mano, sale en verde.
- [ ] **T14: E2E contra producción**
  - Verificar: `BASE_URL=<prod> npm run e2e` en verde, incluido el aislamiento RLS. Informe de Testing.

## Fase 5: Entrega
- [ ] **T15: README** (URL, cuenta demo, diagrama del equipo, cómo ejecutarlo y decisiones) **y escaneo de secretos en todo el historial** (`git log -p` con los patrones de D-04).
- [ ] **T16: Respuestas a las 4 preguntas** (borrador del Orquestador; el humano lo revisa y le pone su voz).
