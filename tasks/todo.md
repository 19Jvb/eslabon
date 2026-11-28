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
- [x] **T10: Landing pública con el CTA de la demo** (S): SPEC F1. Heredado de T05-r1: la portada enlaza a /login y a /registro.
  - `/` responde 200 sin sesión y es estática (no lee cookies ni datos del usuario).
  - Contenido: h1 «Eslabón», el lema «No rompas la cadena.», una explicación de 1 o 2 frases y 3 puntos con estos títulos exactos: «Marca cada día», «Mira crecer tu racha» y «Tus datos son solo tuyos».
  - Acciones: el botón «Probar con la cuenta demo» (la misma Server Action `signInDemo` de T05 → `/app` con la demo) y los enlaces «Entrar» (→ /login) y «Crear cuenta» (→ /registro).
  - `<title>` «Eslabón · No rompas la cadena» y una `meta description` en español.
  - D-10 en el botón demo (un 500 → el genérico, sin perder la página). D-11 (axe y teclado). D-12 (375 px, 44×44).
- [x] **T11: Pulido visual (identidad de cadena y eslabones) y accesibilidad** (M): D-11 y D-12 en todas las páginas.
  - Dirección visual (Orquestador con la skill impeccable, modo *polish*: se conserva la identidad actual, con la paleta verde, la estructura y los textos; las capturas de partida están revisadas):
    1. **Tipografía propia** con `next/font/google` (viene con Next, se autoaloja en el build y no es una dependencia nueva): **Bricolage Grotesque** (600–700) para el h1 y los encabezados, e **Instrument Sans** para el texto y la UI. `display: swap`. En tiempo de ejecución no puede haber ninguna petición a fonts.googleapis/gstatic.
    2. **El color del hábito recorre su cadena:** los botones de día marcados y las celdas cumplidas del mapa usan el color del hábito (tono 700 con texto blanco en los botones, con contraste de 4.5:1 o más; tono 600 o 700 en las celdas), en lugar del verde para todos. La paleta, en un solo sitio (`src/lib/habits.ts`). Se mantiene cumplido = relleno y no cumplido = solo borde (WCAG 1.4.1).
    3. **Tarjeta del hábito en escritorio (≥ 768 px):** dos columnas alineadas arriba; a la izquierda, la fila de días y justo debajo la `<dl>`; a la derecha, el mapa. Sin el hueco vertical actual entre los días y las estadísticas. En móvil, todo apilado como ahora.
    4. **«Renombrar» y «Borrar» como botones de icono** (SVG propio, mismo trazo, `aria-hidden`), de 44×44, con el mismo nombre accesible («Renombrar <nombre>» / «Borrar <nombre>») y `title` con ese mismo texto. Así el nombre del hábito no se parte en móvil.
    5. **Landing:** fuera las 3 tarjetas iguales (un patrón genérico que la skill veta). En su lugar, una **vista previa estática del producto**: un hábito de ejemplo («Leer 20 minutos») con su fila de 7 días (solo las iniciales L…D, sin fechas, porque la página es estática) y un mapa pequeño con un patrón fijo. La vista previa lleva `aria-hidden` o `role="img"` con un nombre que NO empiece por «Historial de 12 semanas de». Los 3 puntos (los mismos títulos `h2` y los mismos textos) como lista ligera, sin cajas: título y una línea, separados por espacio o por una regla fina. La landing sigue estática (○).
    6. **Marca:** un glifo de eslabón en SVG propio junto a «Eslabón» en la cabecera de /app y en la tarjeta de auth, y el mismo glifo como favicon (`src/app/icon.svg`): `/icon.svg` responde 200 y deja de haber 404 de favicon.
    7. **Superficies del navegador:** `::selection` y `caret-color` con la paleta; `accent-color` en los radios; `font-variant-numeric: tabular-nums` en las cifras de las estadísticas y en los números de los días; `text-underline-offset` en los enlaces; `color-scheme: light`.
    8. **Un solo momento de movimiento:** al marcar un día, el botón se rellena con una transición breve (≤ 200 ms, ease-out, desde un estado ya visible). Con `prefers-reduced-motion: reduce`, sin animación. Nada más se anima.
    9. **Prohibido** (suelo de calidad de impeccable): texto con degradado, glassmorphism decorativo, bordes laterales de color de más de 1 px, sombras duras desplazadas, emoji como iconos, *eyebrows*/*kickers* sobre los títulos y tarjetas anidadas. Los textos secundarios con un contraste de 4.5:1 o más (nada de grises más claros que neutral-500 sobre blanco).
  - Verificación: todos los E2E anteriores en verde (los nombres accesibles no cambian) + los nuevos de Testing. Al terminar, el Orquestador pasa el detector `impeccable detect` sobre los archivos cambiados y revisa capturas a 375, 768 y 1280.
  - Heredado de T10-r1: las dos copias del anillo de foco escritas a mano (`(auth)/layout.tsx:11`, `app/page.tsx:18`) pasan a usar `focusRing` de ui.ts; simplificar la firma de `DemoForm` (el `disabled` que no se usa).
  - Heredado de T08-r1: contraste de las celdas del mapa (WCAG 1.4.11, 3:1 como mínimo para los elementos gráficos): el borde de las no cumplidas y de las futuras, con `neutral-500` o más oscuro.
  - Heredado de T06-r2: al renombrar un hábito ya borrado, el foco no pasa por `body` (unos 275 ms) antes de llegar al h1.
  - Heredado de T05-r2: si la acción falla con un 500, el formulario conserva el email escrito. Si cabe sin complicar, los formularios de auth también funcionan antes de que cargue el JS (mejora progresiva); si no, se documenta como limitación.

- [x] **T11b: Tarjeta del hábito: «Hoy» visible, jerarquía, mapa legible, cadena y movimiento** (M). Origen: crítica de impeccable (28/40, `.impeccable/critique/`, local) + emil-design-eng, con el alcance aprobado por el humano. Pule lo que ya existe; no añade funcionalidades.
  - **Hoy visible [P1]:** el botón de hoy muestra visible «Hoy» (en lugar de la inicial) encima del número, y el de ayer, «Ayer». Hoy, sin marcar, lleva un borde de 2 px o más y más oscuro que el resto (neutral-900). El nombre accesible no cambia («Hoy: <hábito>»).
  - **Jerarquía [P2]:** en la `<dl>` (misma estructura: 3 `<dt>` en el mismo orden y los mismos textos de valor), el valor de «Racha actual» va en `font-display`, con un tamaño de 1,5 veces o más el de los otros dos valores, y en el tono 700 del hábito (contraste ≥ 4.5:1). Los otros dos se quedan como están.
  - **Mapa legible [P2]:** celdas de 12 px (`size-3`) con 3 px de separación. Etiquetas de fila «L», «X» y «V» a la izquierda (`aria-hidden`, fuera de las 84 `[data-day]`). La celda de hoy lleva `data-today="true"` y un anillo visible. Pie mínimo, visible y `aria-hidden`: «Últimas 12 semanas» con una leyenda de cumplido, sin marcar y futuro. El nombre accesible del `role="img"` no cambia.
  - **Cadena:** entre dos días contiguos de la fila, ambos marcados, se ve un conector (un elemento `aria-hidden` con `data-link`, de ancho > 0, en el tono del hábito). Si alguno de los dos no está marcado, el conector no se ve. Sigue a la UI optimista (aparece y desaparece al instante y vuelve atrás si falla).
  - **Movimiento (la regla de T11 se amplía con permiso del humano):** se permiten SOLO estos, todos `motion-safe`, de 200 ms o menos y solo transform/opacity (más los colores del relleno del día):
    - (1) el relleno del día, como ya está, pero con la curva `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` definida en globals.css;
    - (2) feedback al pulsar: `active:scale-[0.97]` en los botones (buttonBase y botones de día), con una transición de transform de 160 ms o menos;
    - (3) un pulso en la cifra de «Racha actual» cuando SUBE tras una acción del usuario (no al cargar), ≤ 200 ms;
    - (4) la entrada del diálogo de borrar con `@starting-style` (opacidad 0 y escala 0.97 → 1, ≤ 200 ms, centrado).
    - Con `prefers-reduced-motion: reduce`, nada se mueve.
  - **Anuncio [P2, a11y]:** una región `aria-live="polite"` anuncia «Racha actual de <hábito>: N días» cuando la racha cambia por una acción del usuario (no al cargar la página).
  - **Selector de color:** a 1280 los 6 colores caben en una fila (sin «Violeta» huérfana); a 375, en una rejilla ordenada.
- [x] **T11c: Landing y detalles menores** (S). Mismo origen.
  - El h1 lleva el glifo `aria-hidden` (su nombre accesible sigue siendo exactamente «Eslabón»).
  - Tercer punto, el mismo título, con el texto en lenguaje de usuario: «Nadie más ve tus hábitos: cada cuenta solo puede leer y editar los suyos.».
  - CTA final tras la lista: un enlace «Empieza tu cadena» → /registro (con un nombre distinto de los que ya existen, para no duplicar los roles que usan los tests).
  - La vista previa imita la app: 7 días que terminan en «Hoy» (las iniciales de una semana fija, sin dígitos), la cadena dibujada entre los días consecutivos y el mapa con las etiquetas L/X/V. Sigue `aria-hidden` y estática.
  - Auth: el enlace del logo mide 44 px de alto o más; un separador visual «o» (`aria-hidden`) entre el botón principal y el botón demo.
  - Estado vacío: «Aún no tienes hábitos. Crea el primero en «Nuevo hábito».» (sin referencias de dirección).
  - Heredado de T11b-r1 (S-2): la leyenda del mapa reutiliza `cellClass(…)` en lugar de repetir sus clases (una sola fuente, D-15).
  - Heredado de T11b-r1: feedback al pulsar (`active:scale-[0.97]`, transform ≤ 160 ms, motion-safe) también en los botones de icono Renombrar y Borrar, por coherencia.
  - Fuera de alcance, documentado: título en el diálogo de borrar (cambiaría su nombre accesible, fijado en T06), «Cerrar sesión» → / (T05 fija /login), separar más naranja y ámbar (el contraste mínimo de 3:1 lo limita).

- [x] **T11d: Cadena visible en móvil, aviso de hoy pendiente y estadísticas en la vista previa** (S). Origen: 2.ª crítica de impeccable (28/40, con los 5 problemas de la 1.ª resueltos) y alcance aprobado por el humano. El resto de esa crítica queda documentado como decisión (las flechas en la fila de días y el enlace de salto: poco retorno para la prueba; `maxLength`/`required`: se descartan a propósito desde T06 para mostrar los mensajes del servidor).
  - **Cadena visible a cualquier ancho [P1]:** dos días contiguos marcados se funden en una banda continua. El conector `[data-link]` ocupa el 80 % o más de la altura del botón, con el mismo color de relleno que los botones marcados (el tono 700 del hábito), y las esquinas interiores de los dos botones unidos tienen un radio de 0 (las exteriores conservan el suyo). Sin unir, todo sigue igual. Sigue a la UI optimista y vuelve atrás con un 500. Aplica también a la vista previa de la landing (`ChainLink` compartido).
  - **Aviso de hoy pendiente [P2]:** si hoy no está marcado, debajo de las estadísticas (FUERA de la `<dl>`, para no alterar sus valores) se ve «Marca hoy para llegar a N días» (N = racha actual + 1, con N ≥ 2), o «Marca hoy para empezar tu cadena» si la racha es 0. Con hoy marcado no se muestra. Se actualiza al instante con el estado optimista. Contraste ≥ 4.5:1.
  - **Vista previa fiel [P2]:** la vista previa de la landing añade las mismas tres estadísticas («Racha actual», «Mejor racha», «Últimos 30 días»), con la racha destacada como en la app, y el aviso de hoy pendiente, todo calculado con `src/lib/streak.ts` sobre su propio patrón fijo (no son números inventados). Los días de su fila siguen sin dígitos: los únicos dígitos de la vista previa son los de las estadísticas y los del aviso. Sigue `aria-hidden` y estática.

### Checkpoint C: flujo completo en local; el humano lo prueba

## Fase 4: Publicación
- [x] **T12: Repo en GitHub y despliegue en Vercel** · manual guiado
  - Heredado de T04-r3: declarar en `supabase/config.jsonc` el `site_url` de producción y `additional_redirect_urls` (producción + localhost). Antes del `config push`, repetir `config diff` y confirmar que solo hay `update` declarados y esperados. Región de las funciones de Vercel: `fra1` (Supabase está en eu-central-1).
  - Aceptación: repo público `19Jvb/eslabon` con el CI en verde. Producción con las variables en Vercel y Deployment Protection desactivada.
  - Verificar: `curl -sI <prod>` sin cookies → 200 (no 401 ni redirección a vercel.com), y la ventana de incógnito del humano abre la app.
- [x] **T13: Keep-alive de Supabase** (XS) · manual: secrets de GitHub
  - Aceptación: `.github/workflows/keepalive.yml`, programado (`cron` cada 3 días) y con `workflow_dispatch`. Hace actividad REAL en la BD, la misma que un usuario: (1) login del usuario E2E con la API de Auth (`/auth/v1/token?grant_type=password`), (2) `GET /rest/v1/habits?select=id&limit=1` con su token → 200, (3) logout `scope=local`. Si cualquier paso no da el código esperado, el job FALLA (GitHub avisa al dueño por email). Secrets de GitHub (nunca en el repo): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `E2E_USER_EMAIL` y `E2E_USER_PASSWORD`. Sin imprimir ningún secreto ni token en el log (`::add-mask::` para el token). Permisos `contents: read` y `timeout-minutes`.
  - Heredado de T02-r1: `ci.yml` con `timeout-minutes` y `push` limitado a `main` (los PR siguen con `pull_request`).
  - Paso del Orquestador tras la aprobación: crear los 4 secrets por la API de GitHub (cifrados con la clave pública del repo, sin mostrar los valores), lanzar el workflow con `workflow_dispatch` y comprobar que sale en verde.
  - Verificar: lanzado a mano, sale en verde.
- [x] **T14: E2E contra producción**
  - Verificar: `BASE_URL=<prod> npm run e2e` en verde, incluido el aislamiento RLS. Informe de Testing.

- [x] **T14b: Cabeceras de caché privadas en /app** (XS). Origen: sugerencia de T14-r1 (privacidad). Con sesión, el HTML de /app salía con `Cache-Control: public, max-age=0, must-revalidate` y contenía el email.
  - Aceptación: toda respuesta de `/app` (y de `/app/**`) lleva `Cache-Control` con `private` y `no-store`, comprobado EN PRODUCCIÓN con sesión (curl con la cookie de una sesión del usuario E2E) y en local con `next start`. `/`, `/login` y `/registro` siguen estáticas (○) y sin cambios de caché. Un E2E de Testing lo cubre (con sesión, la cabecera de /app contiene private y no-store). Sin romper los 167 E2E.

## Fase 5: Entrega
- [x] **T15a (Orquestador, justo antes de entregar): recargar los datos de ejemplo de la cuenta demo** (como la demo, borrar sus hábitos y llamar a `load_sample_data` con el hoy de Madrid), para que las rachas estén vivas el día que se evalúa. Borrar también las cuentas `e2e+…@example.com` acumuladas.
- [x] **T15: README** Documentar en «Decisiones»: la ventana de edición de 7 días es una decisión de producto confirmada por el humano el 2026-11-27 (racha honesta, sin cambiar la RLS y sin 84 botones por hábito). Los dos avisos de `db advisors`: (1) `authenticated_security_definer_function_executable` sobre load_sample_data, que es intencionado y está blindado (T09-r1a); (2) `auth_leaked_password_protection`, que hay que comprobar si el plan Free lo permite y activarlo, y si no, documentarlo. (URL, cuenta demo, diagrama del equipo, cómo ejecutarlo y decisiones) **y escaneo de secretos en todo el historial** (`git log -p` con los patrones de D-04).
- [x] **T16: Respuestas a las 4 preguntas** (borrador del Orquestador; el humano lo revisa y le pone su voz).

## Fase 6: bot de Telegram (aprobado por el humano como diferenciador, 2026-11-27)
> Objetivo: una integración real con otro sistema (equivalente a WhatsApp Business API: webhook verificado, vinculación segura de cuentas, idempotencia), hecha con el mismo ciclo de agentes.

**Diseño de seguridad (fijado por el Orquestador):**
- **Sin `service_role`.** La route del webhook no tiene sesión de usuario, así que actúa mediante funciones SQL `security definer` estrechas, ejecutables por `anon`, que exigen un **secreto del bot** (alta entropía) y lo comparan con el guardado en el esquema `private` (que no se expone por la API). El secreto vive solo en Vercel (`TELEGRAM_WEBHOOK_SECRET`) y en `private`, nunca en el repo. Con el secreto solo se pueden hacer estas operaciones, no leer ni escribir tablas arbitrarias. Es mínimo privilegio en lugar de la llave maestra.
- **Webhook verificado:** la cabecera `X-Telegram-Bot-Api-Secret-Token` se compara en tiempo constante con `TELEGRAM_WEBHOOK_SECRET`; si no coincide → 401 y no se procesa nada. Las respuestas a Telegram siempre son 200 rápidas (idempotente ante reintentos).
- **Vinculación:** desde /app, el usuario genera un **código de un solo uso** (aleatorio, 10 minutos, se invalida el anterior). El enlace profundo `https://t.me/<bot>?start=<código>` vincula en un toque (también funciona `/vincular <código>`). Un usuario tiene un chat; volver a vincular sustituye el anterior. «Desvincular» desde la app o con `/desvincular`.
- **El «hoy» del bot:** la zona horaria del usuario (de su cookie `tz`) se guarda al generar el código; si falta → Europe/Madrid. Los días se validan con la misma ventana que la app.
- **Token del bot:** solo en Vercel (`TELEGRAM_BOT_TOKEN`, servidor). El humano lo escribe en `.env.local` y el Orquestador lo sube sin imprimirlo. Nunca pasa por el chat ni por el repo.

- [x] **T17: Migración de Telegram (revisión del SQL en dos fases, como en T09):** las tablas `telegram_links` (user_id pk, chat_id único, tz, linked_at; RLS: el dueño puede select y delete) y `private.telegram_link_codes`; el secreto en `private`; las RPC `create_telegram_link_code(p_tz)` (authenticated) y `telegram_link`, `telegram_unlink`, `telegram_today` y `telegram_set_checkin` (anon, con `p_secret`). Insert idempotente. Ventana de días como la app.
- [x] **T18: Vincular desde /app (UI, la aceptación va primero):** una sección «Telegram» con el estado (vinculado o no), «Vincular con Telegram» (genera el código y muestra el enlace profundo, el código y la caducidad) y «Desvincular». Server Actions con zod, getUser y el genérico.
  - Contrato de la interfaz (debajo de la lista de hábitos, antes de «Nuevo hábito»): sección con h2 «Telegram».
    - **Sin vincular:** el texto «Marca tus hábitos de hoy desde Telegram.» y el botón «Vincular con Telegram». Al pulsarlo (Server Action: getUser + RPC `create_telegram_link_code` con el tz de la cookie) aparecen:
      - un enlace «Abrir Telegram» con `href="https://t.me/<TELEGRAM_BOT_USERNAME>?start=<CÓDIGO>"`, `target="_blank"` y `rel="noopener noreferrer"`;
      - el código visible, de 8 caracteres, con la etiqueta «Código»;
      - el texto «Caduca en 10 minutos. También puedes enviar /vincular <CÓDIGO> al bot.»;
      - el botón «Comprobar vinculación», que vuelve a leer el estado.
      - Volver a pulsar «Vincular con Telegram» genera otro código y el anterior deja de valer.
    - **Vinculado:** el texto «Vinculado con Telegram desde el <fecha>» (fecha `es-ES` larga, en la zona del usuario) y el botón «Desvincular». Al desvincular (getUser + `delete().eq("user_id")`, sin pedir chat_id), vuelve al estado sin vincular.
    - `TELEGRAM_BOT_USERNAME` (servidor; se añade a `.env.example`) da el usuario del bot. Si falta, la sección dice «Telegram no está disponible ahora mismo.» sin romper la página.
    - D-05 (zod + getUser + el genérico, también ante un cuerpo que no es el esperado), D-10 (un 500 → el genérico y la UI estable; doble clic → un solo código), D-11 (axe y teclado) y D-12 (375 px, 44×44).
  - Heredado de T17-r1 (Testing, su territorio): `npm run e2e` en local tiene que salir ENTERO en verde. Hoy cache.spec falla contra `next dev` (en dev no hay `private`). Que el webServer de Playwright use un build de producción (`next build && next start`) cuando no hay BASE_URL, o una solución equivalente que no debilite el test.
  - Heredado de T17-r2: con el grant por columnas, la app pide columnas concretas (`select("user_id, linked_at")`), nunca `select("*")`; desvincular con `delete().eq("user_id", …)` sin returning de todas las columnas (si no, da 42501).
  - Heredado de T17-r1a para T19: normalizar el código (mayúsculas, sin espacios) antes de la RPC; aceptar solo `chat.type === 'private'`; limitar los `/vincular` fallidos por chat; al vincular, avisar en el chat de que la cuenta ha quedado vinculada (contra la ingeniería social). Para T20: no guardar el secreto en snippets del SQL Editor y no vincular nunca la cuenta demo con una cuenta personal de Telegram.
- [x] **T19: Webhook y bot:** `POST /api/telegram/webhook` con la verificación del secreto, y los comandos `/start <código>`, `/vincular <código>`, `/hoy` (lista de hábitos de hoy con botones en línea ✅/⬜ que marcan o desmarcan y editan el mensaje), `/desvincular` y `/ayuda`. Tests unitarios con mocks de la API de Telegram y de las RPC; mensajes en español.
  - **Route** `src/app/api/telegram/webhook/route.ts` (POST):
    - Si la cabecera `X-Telegram-Bot-Api-Secret-Token` no coincide con `TELEGRAM_WEBHOOK_SECRET` (comparación en tiempo constante, por ejemplo `timingSafeEqual` sobre los hashes) → **401** sin procesar nada. Sin secreto configurado → 503.
    - Con el secreto bueno → siempre **200** rápido, también si el update no se entiende o si Telegram falla al enviar (así Telegram no reintenta en bucle).
    - El proxy no la redirige.
  - **Lógica** en una función pura `handleUpdate(update, deps)` en `src/lib/` con las dependencias inyectadas (las RPC de Supabase y la API de Telegram), desarrollada con TDD. La route solo la conecta.
  - **La API de Telegram** se llama con `fetch` a `${TELEGRAM_API_BASE ?? "https://api.telegram.org"}/bot${TELEGRAM_BOT_TOKEN}/<método>`. `TELEGRAM_API_BASE` existe para que los tests apunten a un servidor simulado. El token nunca aparece en un log ni en una respuesta.
  - **Solo chats privados** (`chat.type === "private"`); en otro tipo de chat, el texto «Úsame en un chat privado.» o ignorarlo.
  - **Mensajes en texto plano** (sin `parse_mode`): los nombres de los hábitos los escribe el usuario y no se interpretan como formato.
  - **Comandos (textos exactos):**
    - `/start <código>` y `/vincular <código>`:
      - el código se normaliza (mayúsculas, sin espacios) antes de la RPC;
      - 'linked' → «¡Listo! Tu cuenta de Eslabón está vinculada. Si no has sido tú, envía /desvincular.»;
      - 'invalid_code' → «El código no es válido o ha caducado. Genera otro en la app.».
    - `/start` sin código → «Hola, soy el bot de Eslabón. Para empezar, vincula tu cuenta desde la app con «Vincular con Telegram».».
    - `/vincular` sin código → «Envía /vincular seguido del código que te da la app.».
    - `/hoy`:
      - sin vínculo → «Primero vincula tu cuenta desde la app con «Vincular con Telegram».»;
      - vinculado y sin hábitos → «Aún no tienes hábitos. Créalos en la app.»;
      - con hábitos → «Tus hábitos de hoy (<fecha larga es-ES del today de la RPC>):» y un teclado en línea con un botón por hábito, «✅ <nombre>» o «⬜ <nombre>», con `callback_data` `c:<habit_id>:<1|0>` (1 = marcar). Cabe en 64 bytes.
    - `/desvincular` → «Tu cuenta se ha desvinculado.» (o «No había ninguna cuenta vinculada.»).
    - `/ayuda` y cualquier otro texto → la lista de comandos.
  - **Botón pulsado** (`callback_query`):
    - `telegram_set_checkin(done)`;
    - después `answerCallbackQuery` («Marcado» o «Desmarcado») y `editMessageText` con el teclado actualizado (vuelve a pedir `telegram_today`);
    - si 'not_linked' o 'not_found', la respuesta del callback lo dice.
    - Un `callback_data` mal formado se ignora sin error.
  - **Sin `service_role`:** las RPC se llaman con la publishable key y `p_secret` = `TELEGRAM_WEBHOOK_SECRET`.
  - **Arbitraje del Orquestador sobre «limitar los /vincular fallidos»:** NO se implementa un contador (haría falta otra migración o estado en memoria, que no sirve en serverless). Riesgo aceptado y documentado: el espacio es de 2^40, el código vale 10 minutos, hay uno por usuario y Telegram ya limita el ritmo de mensajes por bot.
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` y `TELEGRAM_API_BASE` en `.env.example`, sin valor.

- [x] **T20: Puesta en marcha y documentación:** las variables en Vercel, `setWebhook` con el `secret_token`, el secreto en `private` (SQL), una prueba real con Telegram (el humano vincula su cuenta y marca un día desde el bot) y el README actualizado. Heredado de T25 (arbitraje de F-9): la captura del chat con `/hoy` (sin el nombre ni el usuario de Telegram del humano) en `docs/capturas/` y enlazada en la sección del bot.

## Fase 7: broche final (pedido por el humano el 2026-11-28: «mejorar un poco más y entregamos»)
> El humano pide gestionar **todo el historial**, no solo la última semana (sustituye la decisión de los 7 días del 2026-11-27), una revisión de seguridad final, el README con capturas y una mejora más a elección del Orquestador (la PWA instalable).

- [x] **T21: Historial completo en la BD y en el servidor (sin UI; SQL en dos fases, como en T09 y T17).**
  - Migración nueva: la política `check_ins_insert_own` pasa a `day between date '2000-01-01' and current_date + 1` (el +1 cubre UTC+14; el resto de condiciones, igual). Nada más cambia: las funciones del bot siguen trabajando solo con «hoy».
  - `src/lib/dates.ts` (TDD): la constante `EARLIEST_DAY = "2000-01-01"` (la misma fecha que el SQL) e `isEditableDay(day, today)` → `EARLIEST_DAY <= day <= today`. `lastWeek` no cambia (la tarjeta sigue mostrando 7 días).
  - `setCheckIn` acepta cualquier día editable y revalida `/app` y la página del historial del hábito.
  - Fase A (Testing, antes de aplicar, en PGlite): día de hoy, ayer, hace 1 año, 2000-01-01 → se insertan; 1999-12-31 y mañana+1 → rechazados; un usuario sigue sin poder insertar en el hábito de otro. Fase B (contra el alojado, tras el `db push` con el OK del humano): lo mismo por la API con la publishable key.
- [x] **T22: Página de historial por hábito (UI, la aceptación va primero).**
  - En cada tarjeta, un enlace con el texto visible «Historial» y el nombre accesible «Ver el historial de <nombre>» → `/app/habitos/<id>`.
  - `/app/habitos/<id>?mes=YYYY-MM` (sin `mes` o con un valor no válido o fuera de rango → el mes de hoy del usuario):
    - título de la pestaña «Historial de <nombre>»; enlace «Volver a tus hábitos» → `/app`;
    - h1 con el nombre del hábito y sus estadísticas (las mismas piezas que la tarjeta: racha actual, mejor racha y % de 30 días);
    - h2 con el mes en español («Noviembre de 2026») y los enlaces «Mes anterior» y «Mes siguiente». «Mes siguiente» no aparece en el mes de hoy; «Mes anterior» no aparece en enero de 2000;
    - calendario de lunes a domingo con las cabeceras L M X J V S D. Cada día pasado o de hoy es un botón conmutable (`aria-pressed`) cuyo texto visible es el número y cuyo nombre accesible es «<d> de <mes>» (p. ej. «3 de noviembre»); hoy añade «, hoy». Los días futuros no son botones;
    - los días marcados se pintan con el color del hábito y los consecutivos se unen como en la cadena de la tarjeta (piezas de `habit-look.tsx`);
    - UI optimista con vuelta atrás si falla; el error, genérico y con `role="alert"`; las estadísticas se recalculan al marcar.
  - Un id que no es un uuid, que no existe o que es de otro usuario → 404 en español («No encontramos ese hábito.», con un enlace a «Tus hábitos»), sin filtrar si el hábito existe. La app gana su `not-found` en español.
  - Heredado de T21: la landing (`src/app/page.tsx`) deja de decir «puedes corregir los últimos 7 días» (S-3) y el `it` de `src/lib/dates.test.ts:142` deja de hablar de «7 días editables» (S-1).
  - D-05, D-10 (500 → genérico, doble clic), D-11 (axe y teclado), D-12 (375 px, 44×44) y la caché `private, no-store` también en `/app/habitos/**`.
- [x] **T23: App instalable (PWA) (S, UI mínima).** Origen: sugerencia del Orquestador aprobada por delegación del humano.
  - `src/app/manifest.ts`: name y short_name «Eslabón», la descripción de la landing, `lang: "es"`, `start_url: "/app"`, `display: "standalone"`, `background_color` y `theme_color` de la identidad, e iconos PNG de 192 y 512 (y uno 512 `maskable`) generados a partir de `icon.svg`, sin dependencias nuevas. `apple-icon` de 180. `themeColor` en el viewport.
  - Heredado de T22-r1: S-1 `prefetch={false}` en el enlace «Historial» de cada tarjeta (cada prefetch pasa por la consulta del proxy); S-2 la marca «Eslabón» también en el 404 general; S-3 si el hábito ya no existe al marcar desde el historial, el aviso ofrece el enlace a «Tus hábitos».
  - Aceptación: `/manifest.webmanifest` responde 200 con esos campos; cada icono responde 200 `image/png` con su tamaño real; el HTML enlaza el manifest; el proxy no los redirige.
- [x] **T24: Revisión de seguridad final.** Heredado de T23-r1 para la ronda de correcciones: S-1 llevar el foco al aviso o a «Tus hábitos» tras «Ese hábito ya no existe.»; S-2 `BRAND_DESCRIPTION` también en la description del layout raíz. Una auditoría independiente (agente security-auditor, solo lectura) de todo el repo: webhook, RPC del bot, Server Actions, RLS, cabeceras, secretos. Los hallazgos que se acepten se corrigen con el ciclo Develop → Testing; los que no, se documentan con su motivo.
- [x] **T25: README final con capturas** (Orquestador): capturas reales de la landing, /app y el historial, la sección del bot (incluida la nota de que la demo es compartida: el último que la vincula se la queda), la PWA, el historial completo en «Decisiones» y las cifras de tests al día.
  - Arbitraje del Orquestador (T25-r1, F-9): la captura del chat con el bot depende del humano y pasa a T20, que sigue abierta hasta su prueba real con su propia cuenta; T25 se cierra sin ella.
  - Verificación obligatoria tras el despliegue (de T22-r1): `BASE_URL=https://eslabon-theta.vercel.app npx playwright test e2e/history.spec.ts -g "Cache-Control|404"` (el 404 reescrito por el proxy y `private, no-store` en Vercel).

## Fase 8: el bot hace todo lo de la web (pedido por el humano el 2026-11-28)
> «Vamos a añadirle funciones al bot para poder hacerlo desde Telegram todo.» Paridad con la web: ver los hábitos con sus estadísticas, marcar cualquier día del historial, crear, renombrar, borrar y cargar los datos de ejemplo.

**Diseño (fijado por el Orquestador):**
- **Mismo modelo de seguridad que T17:** solo RPC `security definer` estrechas para `anon` que exigen `p_secret` y actúan sobre el usuario del vínculo (`chat_id` → `user_id`). Nada de `service_role`. Cada RPC comprueba que el hábito es del usuario vinculado.
- **Las estadísticas se calculan en TypeScript** con las mismas funciones puras que la web (`src/lib/streak.ts`, `src/lib/dates.ts`): la RPC devuelve los días marcados y el «hoy» del vínculo.
- **Conversación con estado** para lo que necesita texto libre (el nombre de un hábito nuevo o renombrado): una fila por chat en `private.telegram_pending` (acción, hábito, nombre, caduca a los 10 minutos). Cualquier comando la cancela; `/cancelar` también.
- **El límite de 50 también por el bot:** el trigger de T24 no cuenta cuando `auth.uid()` es null (como en estas RPC), así que la RPC de crear comprueba el límite ella misma, con el mismo advisory lock por usuario.
- **Las mismas reglas que la web:** nombre de 1 a 60 caracteres sin espacios sobrantes y único por usuario (sin distinguir mayúsculas), colores de la paleta, días desde el 2000-01-01 hasta el «hoy» del vínculo.
- **Texto plano** (sin `parse_mode`) y `callback_data` de 64 bytes como máximo.

- [x] **T26: Migración del bot completo (SQL en dos fases):** `private.telegram_pending` y las RPC para `anon` con `p_secret`:
  - `telegram_habits(p_secret, p_chat_id)` → los hábitos del vínculo (`habit_id`, `name`, `color`, `days date[]` con todos sus días marcados) y `today`;
  - `telegram_set_day(p_secret, p_chat_id, p_habit_id, p_day, p_done)` → 'ok' | 'not_linked' | 'not_found' | 'out_of_range' (idempotente);
  - `telegram_start_create(p_secret, p_chat_id, p_name)` → guarda la acción pendiente → 'ok' | 'not_linked' | 'invalid' | 'duplicate' | 'limit';
  - `telegram_create_habit(p_secret, p_chat_id, p_color)` → crea con el nombre pendiente → 'ok' | 'not_linked' | 'no_pending' | 'invalid' | 'duplicate' | 'limit';
  - `telegram_start_rename(p_secret, p_chat_id, p_habit_id)` → 'ok' | 'not_linked' | 'not_found';
  - `telegram_pending_action(p_secret, p_chat_id)` → la acción pendiente vigente (o ninguna), para encaminar el texto libre;
  - `telegram_rename_habit(p_secret, p_chat_id, p_name)` → 'ok' | 'not_linked' | 'no_pending' | 'not_found' | 'invalid' | 'duplicate';
  - `telegram_cancel(p_secret, p_chat_id)`;
  - `telegram_delete_habit(p_secret, p_chat_id, p_habit_id)` → 'ok' | 'not_linked' | 'not_found';
  - `telegram_load_sample(p_secret, p_chat_id)` → 'ok' | 'not_linked' | 'not_empty'. Reutiliza la lógica de `load_sample_data` sin duplicarla: se extrae a una función privada que reciben las dos.
  - Al desvincular o volver a vincular, se borra la acción pendiente del chat.
  - Fase A en PGlite: aislamiento (nada sobre hábitos de otro usuario ni sin vínculo), secreto obligatorio, límite de 50 también con inserts simultáneos, unicidad y validación del nombre, rango de días, caducidad de lo pendiente, idempotencia y mutaciones. Fase B contra el alojado tras el `db push` con el OK del humano.
- [x] **T27: El bot ve y marca todo (la aceptación va primero, con el simulador):**
  - `/habitos`: un mensaje con cada hábito y sus estadísticas («Racha actual», «Mejor racha», «Últimos 30 días») y un botón por hábito que abre su menú. Sin hábitos: el texto de la web y un botón «Cargar datos de ejemplo».
  - Menú del hábito (edita el mensaje): el nombre, sus estadísticas y los botones «📅 Historial», «✏️ Renombrar», «🗑️ Borrar» y «⬅️ Volver».
  - Historial: calendario mensual en el teclado en línea (fila de navegación «‹» / «Noviembre de 2026» / «›», fila L M X J V S D, un botón por día). Pulsar un día pasado o de hoy lo marca o desmarca y edita el mensaje; los días marcados se distinguen a simple vista; los futuros y los huecos no hacen nada. Navegación entre 2000-01 y el mes de hoy del vínculo.
  - Borrar: confirmación «¿Borrar «<nombre>» y todo su historial?» con «Sí, borrar» y «Cancelar».
  - `/hoy` sigue igual. Lo marcado en el bot se ve en la web al recargar, y al revés.
  - Heredado de T26-r1 (S-1): cualquier error de una RPC (p. ej. un 23503 si el hábito se borra en medio) → el bot responde con un mensaje genérico en español y el webhook sigue devolviendo 200; nunca el error crudo.
- [x] **T28: El bot crea y renombra (la aceptación va primero):**
  - `/nuevo <nombre>` (o `/nuevo` a secas → pide el nombre): valida el nombre como la web y ofrece la paleta (🔴 🟠 🟡 🟢 🔵 🟣); al elegir el color, crea el hábito y lo confirma. Mensajes en español para el duplicado, el límite («Has llegado al máximo de 50 hábitos.») y el nombre no válido.
  - «✏️ Renombrar» → «Escribe el nuevo nombre de «<nombre>».»; el siguiente texto lo renombra (mismas validaciones).
  - `/ejemplo`: carga los datos de ejemplo si la cuenta está vacía.
  - Heredado de T26-r1: S-2 cualquier comando cancela lo pendiente (`telegram_cancel`) antes de ejecutarse, para que un texto posterior no renombre un hábito de una acción anterior; S-3 el bot hace `trim()` del nombre antes de mandarlo (la BD solo quita espacios con `btrim`).
  - `/cancelar` y `/ayuda` (con la lista completa de comandos). El Orquestador actualiza los comandos del bot (`setMyCommands`) con el OK del humano.
- [x] **T29: Puesta en producción y documentación del bot completo:** (prueba real del humano hecha el 2026-11-28: el calendario se ve bien en su móvil) el `db push` (OK del humano), el despliegue, la prueba contra producción, `setMyCommands` y la sección del bot del README; en la prueba real, comprobar que «✅18» y «(27)» caben sin recortarse en las 7 columnas del calendario (de T27-r2; si no, una forma más corta que conserve el número, p. ej. «18✓») (los avisos de `db advisors` pasan de 8 a 18: 15 RPC del bot para anon, 2 para authenticated y leaked password).
