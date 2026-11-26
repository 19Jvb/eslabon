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
- [x] **T02: CI en GitHub Actions** (XS)
  - Aceptación: `.github/workflows/ci.yml` ejecuta `npm ci && npm run check` en cada push y PR, con Node 22. El build usa valores ficticios que no se parecen a claves reales (`NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy`), para no disparar D-04.
  - Verificar: el YAML es válido. En verde tras el primer push (T12).
- [x] **T03: Lógica pura de fechas y rachas, con TDD** (M, sin UI)
  - Aceptación:
    - `src/lib/dates.ts`: `todayIn(tz)`, `addDays`, `isEditableDay(day, today)` (de hoy a hoy−6).
    - `src/lib/streak.ts`: `currentStreak` (si hoy no está marcado, la racha que viene de ayer sigue viva), `bestStreak`, `completionRate(days, today, 30)` y `heatmapWeeks(days, today, 12)`.
  - Verificar: tests de fin de mes y de año, 29 de febrero, cambio de horario en Europe/Madrid (último domingo de marzo y de octubre), conjunto vacío y entrada desordenada o duplicada.

### Checkpoint A: el humano revisa los informes y las rondas de rechazo

## Fase 2: Supabase y Auth
- [x] **T04: Esquema, RLS y clientes de Supabase** (M, sin UI) · manual: el humano crea el proyecto y ejecuta el SQL
  - Aceptación:
    - `supabase/migrations/<timestamp>_init.sql` (creada con `npx supabase@latest migration new init`): las tablas, restricciones y RLS de SPEC §7.
    - **Protección de la cuenta demo:** un trigger `before update on auth.users` que lanza un error si cambia `email` o `encrypted_password` de un usuario con `raw_app_meta_data->>'demo' = 'true'`. La marca se pone a mano en el SQL Editor, así el email no queda escrito en el repo.
    - Clientes de servidor y navegador con `@supabase/ssr`. Refresco de sesión en `proxy.ts`.
  - Verificar: el SQL se ejecuta sin errores. Sin sesión, una consulta con la publishable key devuelve 0 filas.
- [x] **T05: Auth: registro, login, logout y acceso demo** (M, con UI) · manual: el humano crea el usuario demo (lo marca como demo) y el de E2E. El Orquestador ejecuta `npx playwright install chromium`
  - Aceptación (con los nombres visibles exactos que usarán los E2E):
    - `/login` tiene «Email», «Contraseña» y el botón «Entrar». `/registro`, «Email», «Contraseña» y «Crear cuenta». Ambas, el botón «Probar con la cuenta demo».
    - Errores en español: «Email o contraseña incorrectos», «Ya existe una cuenta con ese email», «La contraseña debe tener al menos 8 caracteres».
    - `/app` sin sesión → `/login`. `/login` con sesión → `/app`. Botón «Cerrar sesión».
    - `/app` (esqueleto, los hábitos llegan en T06): encabezado h1 «Tus hábitos» y el email del usuario visible. «Cerrar sesión» lleva a `/login`. `/registro` con sesión → `/app`. Tras un registro correcto se entra directamente en `/app` (no hay confirmación de email).
    - Sin parámetro `?next=` (YAGNI): después del login siempre se va a `/app`.
    - Cada `<title>` de página es descriptivo: «Entrar · Eslabón», «Crear cuenta · Eslabón» y «Tus hábitos · Eslabón».
  - Verificar: E2E de auth, RLS (D-06), cuenta demo protegida (D-06), axe (D-11) y 375 px (D-12).

### Checkpoint B: login demo funcionando en local

## Fase 3: Funcionalidades (todas con UI: Testing escribe primero los E2E)
- [x] **T06: Hábitos: crear, listar, renombrar y borrar** (M): SPEC F3. Nombres visibles: «Nuevo hábito», «Nombre», «Crear», «Renombrar», «Borrar» y la confirmación «Sí, borrar».
  - Lista: los hábitos del usuario en una lista (`<ul>`/`<li>`), ordenados por fecha de creación (el más antiguo primero), cada uno con su nombre y una muestra de su color.
  - Vacío: si no hay hábitos, se ve el texto «Aún no tienes hábitos» junto al formulario de creación.
  - Crear: sección con el encabezado «Nuevo hábito», campo «Nombre», un grupo de radios «Color» (Rojo, Naranja, Ámbar, Verde, Azul y Violeta; por defecto Verde) y el botón «Crear». Tras crear, el campo se vacía y el hábito aparece en la lista.
  - Errores (en `role="alert"`): «Escribe un nombre» (vacío o solo espacios), «Máximo 60 caracteres» y «Ya tienes un hábito con ese nombre.» (también si solo cambian mayúsculas o minúsculas).
  - Renombrar: cada hábito tiene un botón con el nombre accesible «Renombrar <nombre>». Abre un formulario en línea con el campo «Nuevo nombre» ya relleno y los botones «Guardar» y «Cancelar». Escape cancela. Se aplican los mismos errores.
  - Borrar: botón «Borrar <nombre>» → confirmación (diálogo accesible) con el texto «¿Borrar «<nombre>»? Se perderá su historial.» y los botones «Sí, borrar» y «Cancelar». El foco vuelve a un sitio lógico al cerrar.
  - Fuera de alcance: cambiar el color de un hábito ya creado.
  - Heredado de T05-r1: con más rutas bajo /app, la comprobación de sesión sube a `src/app/app/layout.tsx`.
  - Heredado de T04-r2: para editar se usa `update({ name, color }).eq("id", …)`, nunca `upsert`, porque el grant de update es solo sobre esas columnas y tocar `id` o `user_id` da 42501. El 23505 se convierte en «Ya tienes un hábito con ese nombre.».
- [x] **T07: Marcar y desmarcar días** (hoy y los 6 anteriores), cookie de zona horaria y UI optimista (M): SPEC F4 y D-10.
  - Cada hábito de la lista muestra una fila con sus **7 últimos días** (de hoy−6 a hoy, de izquierda a derecha). Cada día es un `<button>` con `aria-pressed` (true = marcado) y el atributo `data-day="YYYY-MM-DD"` (el contrato para los tests).
  - Nombre accesible de cada botón: `«<etiqueta>: <nombre del hábito>»`. La etiqueta es «Hoy» para hoy, «Ayer» para ayer, y para el resto el día de la semana con mayúscula y el número del día (p. ej. «Lunes 23»), calculados en la zona del usuario. Visualmente cada botón muestra la inicial del día y el número.
  - Pulsar cambia el estado al instante (UI optimista con `useOptimistic`). Si la acción falla: vuelve al estado anterior y sale el genérico en `role="alert"`. Tras un doble clic rápido, el estado de la UI coincide con el de la BD al recargar.
  - Zona horaria: un script mínimo de cliente guarda `Intl.DateTimeFormat().resolvedOptions().timeZone` en la cookie `tz` (path=/, SameSite=Lax, 1 año). El servidor calcula «hoy» con `todayIn(tz)`. Si la cookie falta o no es válida → `Europe/Madrid`. Con un navegador en `Pacific/Kiritimati` o en `Pacific/Honolulu`, el `data-day` de «Hoy» es el día de esa zona.
  - El servidor rechaza cualquier día fuera de `isEditableDay` (futuro, más de 6 días atrás o malformado) con «Solo puedes marcar los últimos 7 días.», sin tocar la BD.
  - Heredado de T06-r2: `signIn` y `signUp` (src/app/(auth)/actions.ts) devuelven el genérico si el argumento no es `FormData`, antes de `Object.fromEntries`, para no responder 500 a peticiones manipuladas. Las acciones nuevas de T07 siguen el mismo patrón.
  - Heredado de T06-r1: si T07 añade una tercera copia de las clases de input y botón (auth-form, sign-out-form, habit-forms), se unifican en un solo sitio.
  - Heredado de T04-r2: marcar un día es un `insert`, y el 23505 se trata como «ya estaba marcado» (idempotente). Desmarcar es un `delete`. Nada de update ni de `upsert` con update (darían 42501).
  - Heredado de T03-r1 (sugerencias que pasan a ser criterios): si falta la cookie `tz`, o no es válida, se usa `Europe/Madrid`, nunca la zona del servidor. Los días que llegan del cliente se validan con `isEditableDay` antes de tocar la BD (`addDays` no valida: `2026-02-30` se normaliza sin avisar). Una línea en `dates.ts` deja claro ese contrato.
- [x] **T08: Estadísticas y mapa de calor de 12 semanas** (M): SPEC F5.
  - Cada hábito muestra sus estadísticas en una `<dl>` con los términos «Racha actual», «Mejor racha» y «Últimos 30 días». Los valores son «N días» («1 día» en singular, «0 días» si es cero) y «N %», calculados con `currentStreak`, `bestStreak` y `completionRate` de `src/lib/streak.ts`, con el «hoy» del usuario (`userToday`). La mejor racha es la de **todo el historial**, no la de una ventana.
  - Mapa de calor de 12 semanas por hábito: rejilla de 12 columnas (semanas, de lunes a domingo) por 7 filas, salida de `heatmapWeeks`. El contenedor tiene `role="img"` y el nombre accesible «Historial de 12 semanas de <hábito>: N de M días cumplidos» (M = los días no futuros de la rejilla). Las celdas van con `aria-hidden` y llevan `data-day` y `data-done="true|false"`; las futuras, además, `data-future="true"`. Cumplido y no cumplido se distinguen con algo más que el color (WCAG 1.4.1: borde o relleno). Cabe a 375 px sin scroll horizontal.
  - Tras marcar o desmarcar un día (T07), las estadísticas y el mapa se actualizan sin recargar.
  - Sin dependencias nuevas: la rejilla se hace con CSS grid.
  - Heredado de T07-r1: marcar un día de un hábito ya borrado (en otra pestaña) responde «Ese hábito ya no existe.» y revalida /app, igual que renombrar y borrar. La consulta de check_ins de las estadísticas no puede cortar filas sin avisar por el `max_rows` de 1000 de PostgREST: o se acota el número de hábitos por usuario (con una restricción en la BD) o se pagina, y se elige lo más simple que sea correcto.
  - Heredado de T03-r1: `completionRate` con `windowDays <= 0` no puede devolver `NaN` (que devuelva 0 o lance un error claro, con su test), y `heatmapWeeks` tiene un test del cambio de horario de marzo.
- [x] **T09: «Cargar datos de ejemplo», idempotente** (S): SPEC F6.
  - En el estado vacío de /app (0 hábitos) aparece el botón «Cargar datos de ejemplo». Con 1 hábito o más, no aparece.
  - Al pulsarlo se crean exactamente 3 hábitos: «Leer 20 minutos» (azul), «Caminar 30 minutos» (verde) y «Beber 2 litros de agua» (ámbar). Tienen unos 60 días de historial **deterministas** (un patrón fijo según el desplazamiento del día, sin azar, para poder testearlo) y realistas: rachas variadas, algún hueco y una mejor racha mayor que la actual en al menos uno. **Hoy queda sin marcar** en los 3, para que quien evalúe lo marque y vea subir la racha.
  - Idempotente: con hábitos ya existentes no hace nada. El doble clic o dos llamadas a la vez dejan exactamente 3 hábitos (sin duplicados ni error crudo).
  - Migración NUEVA con una función `public.load_sample_data(p_today date)`. Requisitos:
    - `security definer`, `set search_path = ''` y todo cualificado con su esquema;
    - `revoke all … from public, anon`; `grant execute … to authenticated`;
    - usa `auth.uid()` (error si es null) y nunca un user_id que llegue de fuera;
    - valida `p_today between current_date - 1 and current_date + 1` (el «hoy» del usuario según su zona) y genera los días relativos a `p_today`, todos `< p_today`.
    - Se llama con `supabase.rpc` desde una Server Action (zod + getUser + el genérico).
  - Después de aplicarla, `db advisors` no da problemas nuevos.
  - Paso del Orquestador tras la aprobación y con el OK del humano: aplicar la migración (`db push`) y cargar los datos de ejemplo en la cuenta demo, para que quien evalúe vea datos nada más entrar.
  - Heredado de T08-r1: (a) en `setCheckIn`, ante un 42501 se comprueba si el hábito existe (`select id … maybeSingle`): si no existe, HABIT_GONE; si existe, el genérico. Así nunca se dice «ya no existe» por error. (b) `fetchAll` pagina por clave (`habit_id`, `day`) en vez de por posición, para no saltarse filas si se borra una entre páginas, y su test simula el 416 real (PGRST103) en vez de un 200 vacío.
  - OJO (Orquestador, al planificar T08): la RLS de check_ins solo permite insertar días entre `current_date - 8` y `current_date + 1`. Un historial de unos 60 días NO se puede insertar desde el cliente. Hace falta una migración nueva con una función `security definer` (`set search_path = ''`, `revoke execute ... from public, anon`, grant solo a authenticated) que inserte los datos de ejemplo para `auth.uid()`, solo si el usuario no tiene hábitos (idempotente). Se llama por RPC desde una Server Action. La revisión de seguridad de esa función es obligatoria (D-06). La migración se aplica con el OK del humano.
- [ ] **T10: Landing pública con el CTA de la demo** (S): SPEC F1. Heredado de T05-r1: la portada enlaza a /login y a /registro.
  - `/` responde 200 sin sesión y es estática (no lee cookies ni datos del usuario).
  - Contenido: h1 «Eslabón», el lema «No rompas la cadena.», una explicación de 1 o 2 frases y 3 puntos con estos títulos exactos: «Marca cada día», «Mira crecer tu racha» y «Tus datos son solo tuyos».
  - Acciones: el botón «Probar con la cuenta demo» (la misma Server Action `signInDemo` de T05 → `/app` con la demo) y los enlaces «Entrar» (→ /login) y «Crear cuenta» (→ /registro).
  - `<title>` «Eslabón · No rompas la cadena» y una `meta description` en español.
  - D-10 en el botón demo (un 500 → el genérico, sin perder la página). D-11 (axe y teclado). D-12 (375 px, 44×44).
- [ ] **T11: Pulido visual (identidad de cadena y eslabones) y accesibilidad** (M): D-11 y D-12 en todas las páginas.
  - Heredado de T08-r1: contraste de las celdas del mapa (WCAG 1.4.11, 3:1 como mínimo para los elementos gráficos): el borde de las no cumplidas y de las futuras, con `neutral-500` o más oscuro.
  - Heredado de T06-r2: al renombrar un hábito ya borrado, el foco no pasa por `body` (unos 275 ms) antes de llegar al h1.
  - Heredado de T05-r2: si la acción falla con un 500, el formulario conserva el email escrito. Si cabe sin complicar, los formularios de auth también funcionan antes de que cargue el JS (mejora progresiva); si no, se documenta como limitación.

### Checkpoint C: flujo completo en local; el humano lo prueba

## Fase 4: Publicación
- [ ] **T12: Repo en GitHub y despliegue en Vercel** · manual guiado
  - Heredado de T04-r3: declarar en `supabase/config.jsonc` el `site_url` de producción y `additional_redirect_urls` (producción + localhost). Antes del `config push`, repetir `config diff` y confirmar que solo hay `update` declarados y esperados. Región de las funciones de Vercel: `fra1` (Supabase está en eu-central-1).
  - Aceptación: repo público `19Jvb/eslabon` con el CI en verde. Producción con las variables en Vercel y Deployment Protection desactivada.
  - Verificar: `curl -sI <prod>` sin cookies → 200 (no 401 ni redirección a vercel.com), y la ventana de incógnito del humano abre la app.
- [ ] **T13: Keep-alive de Supabase** (XS) · manual: secrets de GitHub
  - Aceptación: un workflow programado (cada 3 días, más `workflow_dispatch`) que hace una consulta ligera con la publishable key.
  - Verificar: lanzado a mano, sale en verde.
- [ ] **T14: E2E contra producción**
  - Verificar: `BASE_URL=<prod> npm run e2e` en verde, incluido el aislamiento RLS. Informe de Testing.

## Fase 5: Entrega
- [ ] **T15a (Orquestador, justo antes de entregar): recargar los datos de ejemplo de la cuenta demo** (como la demo, borrar sus hábitos y llamar a `load_sample_data` con el hoy de Madrid), para que las rachas estén vivas el día que se evalúa. Borrar también las cuentas `e2e+…@example.com` acumuladas.
- [ ] **T15: README** Documentar en «Decisiones» los dos avisos de `db advisors`: (1) `authenticated_security_definer_function_executable` sobre load_sample_data, que es intencionado y está blindado (T09-r1a); (2) `auth_leaked_password_protection`, que hay que comprobar si el plan Free lo permite y activarlo, y si no, documentarlo. (URL, cuenta demo, diagrama del equipo, cómo ejecutarlo y decisiones) **y escaneo de secretos en todo el historial** (`git log -p` con los patrones de D-04).
- [ ] **T16: Respuestas a las 4 preguntas** (borrador del Orquestador; el humano lo revisa y le pone su voz).
