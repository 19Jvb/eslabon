# Spec: «Eslabón», tracker de hábitos hecho por un equipo de 3 agentes

> Documento vivo. Si cambia una decisión, se actualiza aquí **antes** de tocar el código.

## 1. Objetivo

**Qué entrega la prueba:** un proyecto Next.js construido por tres agentes de Claude Code (Orquestador, Develop y Testing), con base de datos Supabase gratuita y publicado en Vercel en una URL **pública** de producción.

**La app:** «Eslabón» («no rompas la cadena»: cada día cumplido es un eslabón) sirve para crear hábitos diarios, marcarlos cada día y ver la constancia (racha actual, mejor racha, % de cumplimiento y un mapa de calor). Cada usuario ve **solo sus datos**.

**Quién la usa:** cualquiera que se registre. Para la evaluación hay una cuenta demo con datos: se entra con el botón «Probar con la cuenta demo».

**Principios del proceso:**
1. **Trazabilidad.** Cada ronda de Testing deja un informe en `docs/revisiones/` y cada tarea aprobada es un commit que enlaza su informe.
2. **La aceptación va primero.** En las tareas con UI, Testing escribe los E2E a partir de los criterios antes de la implementación. Develop los ejecuta pero no los edita.
3. **Directrices verificables.** Cada directriz tiene un ID estable (`D-xx`) y un comando o una inspección concreta que la comprueba.
4. **Corrección en los bordes.** El «hoy» se calcula en la zona horaria del usuario (el servidor está en UTC); las rachas que cruzan el cambio de mes, de año o de horario están testeadas, y el aislamiento entre usuarios se prueba contra la API real.

## 2. Supuestos (aprobados)

1. La interfaz está en español. El código y los identificadores, en inglés.
2. Login con email y contraseña de Supabase. **«Confirm email» desactivado** en Supabase, para que registrarse sea inmediato (el SMTP gratuito de Supabase limita mucho los envíos). Queda documentado como decisión.
3. Solo hábitos **diarios**. Los semanales o «X veces por semana» quedan fuera del alcance.
4. Se pueden marcar o desmarcar **hoy y los 6 días anteriores** («ayer se me olvidó»). Los días futuros nunca.
5. La zona horaria del usuario la da el navegador (`Intl`) y se guarda en una cookie. Si no hay cookie, se usa `Europe/Madrid`.
6. La cuenta demo es compartida por quien evalúe. Por eso existe «Cargar datos de ejemplo» para cualquier cuenta sin hábitos, por si alguien la vacía.

## 3. Funcionalidades y criterios de aceptación

| ID | Funcionalidad | Criterios de aceptación |
|---|---|---|
| F1 | Landing pública | `/` responde 200 sin sesión. Explica la app y tiene el CTA «Probar con la cuenta demo» y enlaces a login y registro. |
| F2 | Autenticación | Registro, login y logout. Errores claros y en español (credenciales incorrectas, email ya usado, contraseña de menos de 8). `/app/**` sin sesión → redirige a `/login`. Con sesión, `/login` → redirige a `/app`. El botón demo entra con la cuenta demo. |
| F3 | Hábitos (CRUD) | Crear (nombre de 1 a 60 caracteres sin espacios sobrantes, color de una paleta fija), renombrar y borrar con confirmación. Se valida igual en el cliente y en el servidor (zod). No se permiten dos hábitos activos con el mismo nombre (lo impone una restricción en la BD). |
| F4 | Marcar el día | Un toggle por hábito para hoy, con UI optimista y vuelta atrás si falla. El doble clic no crea duplicados (PK `(habit_id, day)`). En la tarjeta se marcan los últimos 7 días; en la página de historial de cada hábito (calendario mensual), cualquier día desde el 2000-01-01 hasta hoy (cambio pedido por el humano el 2026-11-28). El servidor rechaza fechas futuras o anteriores a esa. |
| F5 | Estadísticas | Por hábito: racha actual (si hoy aún no está marcado, la racha que viene de ayer sigue viva), mejor racha, % de los últimos 30 días y mapa de calor de 12 semanas. Todo se calcula con funciones puras testeadas. |
| F6 | Datos de ejemplo | Si la cuenta no tiene hábitos, aparece el botón «Cargar datos de ejemplo»: 3 hábitos con unos 60 días de historial realista. Es idempotente. |
| F7 | Seguridad de datos | RLS activada en todas las tablas: un usuario no puede leer ni escribir nada de otro, aunque llame directamente a la API de Supabase con la anon key. |

## 4. Stack

- **Next.js 16** (App Router, Server Components, Server Actions), con la versión que instale `create-next-app@latest` (hoy 16.4.x), **React 19**, **TypeScript** estricto y **Tailwind CSS 4**.
- **Supabase**: Postgres, Auth y RLS, con `@supabase/ssr` y `@supabase/supabase-js`.
- **zod** para validar en los límites de confianza.
- **Vitest** para los tests unitarios. **Playwright** + **@axe-core/playwright** para E2E y accesibilidad.
- **Vercel** (plan Hobby) y **GitHub Actions** (CI).
- Ninguna dependencia más sin aprobación (ver Límites).

## 5. Comandos

```bash
npm run dev          # desarrollo en http://localhost:3000
npm run lint         # ESLint, 0 errores y 0 warnings
npm run typecheck    # tsc --noEmit
npm test             # Vitest (unitarios)
npm run build        # build de producción
npm run check        # eslint --max-warnings=0 && tsc --noEmit && vitest run && next build: la puerta de Testing y de CI
npm run e2e          # Playwright contra BASE_URL (por defecto localhost:3000)
BASE_URL=https://<prod>.vercel.app npm run e2e   # E2E contra producción
```

## 6. Estructura

```
CLAUDE.md                  → Orquestador: reglas del equipo y el ciclo Develop ⇄ Testing
.claude/agents/develop.md  → Subagente Develop: cómo programar en este repo
.claude/agents/testing.md  → Subagente Testing: DIRECTRICES D-xx y formato del informe
SPEC.md                    → este documento
tasks/plan.md, todo.md     → plan y tareas con sus criterios
docs/revisiones/           → un informe por tarea y ronda de Testing (la evidencia)
supabase/migrations/       → el SQL versionado (esquema + RLS)
src/app/                   → rutas: / (landing), /login, /registro, /app
src/lib/                   → lógica pura (fechas, rachas), clientes de Supabase, esquemas zod
src/lib/**/*.test.ts       → tests unitarios junto a su código
e2e/                       → tests de aceptación (solo los escribe Testing)
.github/workflows/ci.yml   → CI: npm run check
.env.example               → nombres de las variables, sin valores
```

## 7. Modelo de datos (Supabase)

```sql
habits    (id uuid pk, user_id uuid → auth.users default auth.uid(),
           name text check 1..60, color text check en paleta, created_at timestamptz)
           unique (user_id, lower(name))
check_ins (habit_id uuid → habits on delete cascade, user_id uuid default auth.uid(),
           day date, created_at timestamptz, primary key (habit_id, day))
```
RLS: en las dos tablas, `select/insert/update/delete` solo cuando `user_id = auth.uid()`. Además, en `check_ins` el hábito tiene que ser del mismo usuario. En la app solo se usa la **anon/publishable key**. La `service_role` no se usa en ningún sitio.

## 8. Estilo de código (referencia)

```ts
// src/lib/streak.ts: lógica pura, sin I/O, días como 'YYYY-MM-DD'
export function currentStreak(days: ReadonlySet<string>, today: string): number {
  let cursor = days.has(today) ? today : addDays(today, -1); // hoy sin marcar no rompe la racha
  let count = 0;
  while (days.has(cursor)) { count++; cursor = addDays(cursor, -1); }
  return count;
}
```
- Server Components por defecto. `"use client"` solo donde hay interacción.
- Las mutaciones son Server Actions: validan con zod, comprueban la sesión, devuelven `{ ok } | { error }` y llaman a `revalidatePath`.
- Nombres: componentes en `PascalCase`, funciones en `camelCase`, archivos en `kebab-case`.
- Nada de `any`, ni `@ts-ignore`, ni `console.log` en el código entregado.

## 9. Estrategia de pruebas

| Nivel | Qué cubre | Quién lo escribe |
|---|---|---|
| Unitario (Vitest) | Fechas y zona horaria, rachas, %, mapa de calor, esquemas zod. Casos límite: fin de mes y de año, cambio de horario, conjunto vacío, días duplicados. | Develop (TDD) |
| E2E (Playwright) | Landing pública, login demo, crear, marcar, desmarcar y borrar un hábito, redirecciones sin sesión, aislamiento entre dos usuarios (RLS) | Testing, **antes** de que Develop implemente (sin leer `src/`) |
| Accesibilidad | axe en landing, login y app: 0 violaciones `serious` o `critical` | Testing |
| Estático | lint, tipos, build, búsqueda de secretos en el repo | Testing (con `npm run check`) |

## 10. Límites

- **Siempre:** `npm run check` en verde antes de entregar una tarea a Testing. Validar entradas en el servidor. Mantener al día `SPEC.md` y `tasks/todo.md`. Commits pequeños, uno por tarea aprobada.
- **Preguntar antes:** añadir dependencias, cambiar el esquema de la BD fuera de una migración nueva, tocar el CI y cualquier paso en servicios externos (GitHub, Supabase, Vercel).
- **Nunca:** subir claves o `.env*` (salvo `.env.example`), usar la `service_role` key, desactivar RLS, saltarse o borrar tests (`.skip`/`.only`) para que algo «pase», y que Develop edite `e2e/` o los informes de Testing.

## 11. Criterios de éxito (entrega)

- [ ] La URL de **producción** abre en incógnito sin pedir login de Vercel (Deployment Protection desactivada).
- [ ] La cuenta demo funciona y muestra datos.
- [ ] `npm run check` y el CI de GitHub en verde.
- [ ] `npm run e2e` en verde contra **producción**, incluido el test de aislamiento RLS.
- [ ] axe: 0 violaciones serious o critical.
- [ ] Cada tarea tiene al menos un informe en `docs/revisiones/` y cada commit de tarea lo enlaza.
- [ ] Ningún secreto en el historial de git (comprobado).
- [ ] README con la URL, la cuenta demo, el diagrama del flujo de agentes, cómo ejecutarlo y las decisiones tomadas.

## 12. Preguntas abiertas

1. **Las 4 preguntas cortas de la entrega:** pégalas cuando las tengas para prepararlas.
2. ~~Nombre~~ → **Eslabón** (decidido). Repo: `github.com/19Jvb/eslabon`.
3. ~~GitHub~~ → `19Jvb` (decidido).
