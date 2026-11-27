# Revisiones de Testing

Cada vez que Develop entrega una tarea, el agente **testing** la revisa contra las directrices `D-xx` de [`.claude/agents/testing.md`](../../.claude/agents/testing.md) y deja aquí un informe, `Txx-rN.md` (tarea `xx`, ronda `N`).

Si la revisión sale **RECHAZADA**, el Orquestador devuelve a Develop los fallos `F-n` literales, Develop los corrige y Testing abre la ronda siguiente. Una tarea solo se cierra, y solo entonces se hace su commit, cuando una ronda sale **APROBADA**.

## Índice (lo mantiene el Orquestador al cerrar cada tarea)

| Tarea | Rondas | Fallos detectados | Informe final |
|---|---|---|---|
| T00 | n/a (los agentes aún no existían) | Revisión externa de los .md: 13 hallazgos aplicados (el crítico fue que los comandos no veían los archivos nuevos → `git add -A -N`) | — |
| T01 | 1 | 0 (3 dudas de Develop arbitradas por el Orquestador) | [T01-r1](T01-r1.md) |
| T02 | 1 | 0 (2 sugerencias: timeout-minutes y doble ejecución push+PR) | [T02-r1](T02-r1.md) |
| T03 | 1 | 0 bloqueantes; 4 sugerencias, 3 llevadas a criterios de T07/T08 | [T03-r1](T03-r1.md) |
| T04 | 3 | r1: 3 (config no nativo, clave obsoleta, **regex del proxy que dejaba rutas sin refrescar la sesión**) · r3: 1 del Orquestador al hacer el diff contra producción (el config completo degradaba 12 ajustes) | [T04-r3](T04-r3.md) |
| T05 | 2 | r1: 1 (**un 500 en una Server Action dejaba la pantalla de error en inglés de Next**; Testing añadió 4 E2E) + 2 sugerencias pasadas a criterios | [T05-r2](T05-r2.md) |
| T06 | 2 | r1: 1 (**mensaje crudo de zod en inglés con entradas manipuladas**; el mismo hueco se corrigió en auth) + 2 sugerencias pasadas a criterios | [T06-r2](T06-r2.md) |
| T07 | 1 | 0 de la app. Testing corrigió 1 test suyo que estaba mal (lo detectó Develop como DISCREPANCIA) y Develop arregló una violación de WCAG 2.5.3 que imponía el contrato | [T07-r1](T07-r1.md) |
| T08 | 1 | 0 bloqueantes. Testing reprodujo el corte de max_rows (1000 de 1050) contra el PostgREST real y validó la paginación; 3 sugerencias pasadas a T09 y T11 | [T08-r1](T08-r1.md) |
| T09 | 1 (en 2 fases) | 0 bloqueantes. Fase A (el SQL antes de aplicarlo, 44 casos adversariales): se incorporó S-1 (zona horaria de sesión manipulable con Prefer) **antes** del db push. Fase B: 98 E2E y la paginación probada con 1012 filas reales | [T09-r1](T09-r1.md) · [fase A](T09-r1a.md) |
| T10 | 1 | 0 bloqueantes. Testing comprobó que las credenciales demo no están en el bundle del cliente y que los botones de auth se bloquean entre sí (una sonda propia, sin E2E previo) | [T10-r1](T10-r1.md) |
| T11 | 1 | 0 bloqueantes. Dirección visual del Orquestador con la skill impeccable; `impeccable detect` sin hallazgos; capturas a 375/768/1280 revisadas por Testing y por el Orquestador. Sugerencias no aplicadas: title con el email de la cabecera; la vista previa de la landing con clases blue-700 a mano en vez de la paleta | [T11-r1](T11-r1.md) |
| T11b | 1 | 0 bloqueantes. Origen: crítica de impeccable (28/40) + emil-design-eng con el alcance aprobado por el humano; Testing reescribió su test de movimiento como lista blanca por el cambio de criterio | [T11b-r1](T11b-r1.md) |
| T11c | 1 | 0 bloqueantes. Piezas compartidas entre la tarjeta y la vista previa en un solo módulo (habit-look.tsx). Sugerencias no aplicadas: conectores más anchos en la vista previa móvil; constante para el anillo de hoy | [T11c-r1](T11c-r1.md) |
| T11d | 1 | 0 bloqueantes. Origen: 2.ª crítica de impeccable (28/40, con los 5 problemas de la 1.ª resueltos). Cadena como banda continua, aviso de hoy pendiente y vista previa fiel | [T11d-r1](T11d-r1.md) |
| T12 | 1 | 0. Publicación: el Orquestador creó el repo por la API, lo subió (CI en verde), creó el proyecto de Vercel por la CLI (región fra1, ssoProtection=null) y desplegó desde un clon limpio → https://eslabon-theta.vercel.app (pública, comprobada sin cookies y por el humano en incógnito). Develop apuntó la config de auth a producción; Testing la aprobó y el Orquestador la aplicó (config diff: update 0) | [T12-r1](T12-r1.md) |
| T13 | 1 | 0 bloqueantes. Testing intentó inyectar código con la contraseña (`$(x)`, comillas invertidas) en una simulación: sin éxito. Ejecución real con secrets (creados cifrados por la API): «login 200, habits 200, logout 204», 0 secretos en el log | [T13-r1](T13-r1.md) |
| T14 | 1 | 0. **167/167 E2E contra producción** a la primera (RLS incluida); TTFB 0,15–0,28 s; ninguna credencial en el bundle; la demo intacta. Testing cambió su rls.spec para no escribir en la demo (papeles A/B invertidos). Sugerencia: el HTML de /app sale con Cache-Control public | [T14-r1](T14-r1.md) |
| T14b | 2 | r1 APROBADO en local, pero **el test nuevo de Testing rompía el build** (TS2322): el CI y Vercel lo pararon (producción intacta). Testing reconoció en r2 que no repitió el check tras editar. Verificado en producción: /app con private, no-store | [T14b-r2](T14b-r2.md) |
| T15 | 2 | r1: 2 en el README del **Orquestador** (faltaban pasos para ejecutarlo en local; «datos de ejemplo» en db push era falso). Testing verificó cada cifra; volvió a pasar la suite completa contra producción: 169/169 | [T15-r1](T15-r1.md) |
| T17 | 2 (fase A) + fase B | Fase A r1: **F-1, el secreto sin CHECK** (un secreto vacío habría abierto las funciones de anon) + S-5 (chat_id legible) y S-1 subidas a criterios. Fase A r2 OK (152/152, 16 mutaciones). Aplicada; fase B 28/28 contra el alojado | [T17-r1](T17-r1.md) · [fase A](T17-r1a.md) |
