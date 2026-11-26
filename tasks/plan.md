# Plan de implementación: Eslabón

## Resumen
Construimos «Eslabón» (SPEC.md) con un equipo de tres agentes. El **Orquestador** (la sesión principal, regida por `CLAUDE.md`) no escribe código de la app: reparte cada tarea a **Develop**, pasa el resultado a **Testing** y repite el ciclo hasta que Testing aprueba. Cada tarea aprobada es un commit que enlaza su informe en `docs/revisiones/`.

## Decisiones de arquitectura
- **Next.js 16 App Router + Server Actions.** No hay API REST propia: las mutaciones son acciones de servidor que validan con zod. Menos código y menos superficie de ataque.
- **La seguridad la impone la BD (RLS), no la app.** Aunque alguien se salte la UI y llame a Supabase con la anon key, no puede ver datos ajenos. Lo comprueba un test E2E.
- **La lógica de fechas y rachas va en funciones puras** (`src/lib/`) y se desarrolla con TDD. Ahí está el riesgo real: la zona horaria y los cambios de mes, de año y de horario.
- **El «hoy» del usuario** se calcula con `Intl` y su zona horaria, que se guarda en una cookie. Nunca con la hora del servidor (Vercel funciona en UTC).
- **Testing es dueño de `e2e/`.** Develop escribe los tests unitarios. Testing escribe primero los de aceptación, a partir de los criterios y sin leer `src/`, y Develop los ejecuta pero no los edita (CLAUDE.md, paso 2 del ciclo).
- **Keep-alive de Supabase.** El plan gratuito pausa el proyecto tras 7 días sin actividad. Un workflow programado de GitHub Actions hace una consulta cada 3 días para que la app siga viva mientras la evalúan.

## Ciclo de cada tarea (lo detalla CLAUDE.md)
```
Orquestador ──tarea + criterios──▶ Develop ──código + npm run check en verde──▶ Orquestador
     ▲                                                                              │
     │                                                                              ▼
     └──── APROBADO → commit «feat(Txx)…» ◀──── informe ◀──── Testing (directrices D-xx + E2E)
                RECHAZADO → fallos numerados → Develop (otra ronda; tras 5 rondas, se escala al humano)
```

## Fases y tareas (detalle en `tasks/todo.md`)

| Fase | Tareas | Quién |
|---|---|---|
| 0. Equipo de agentes | T00 | Orquestador (los subagentes aún no existen) |
| 1. Fundación | T01 scaffold · T02 CI · T03 lógica de fechas y rachas | Develop ⇄ Testing |
| Checkpoint A | check en verde, CI preparado, lógica cubierta | revisa el humano |
| 2. Supabase y Auth | T04 esquema + RLS + clientes · T05 auth + demo | Develop ⇄ Testing + **pasos manuales** |
| Checkpoint B | login demo funcionando en local, E2E de auth en verde | revisa el humano |
| 3. Funcionalidades | T06 hábitos · T07 marcar días · T08 estadísticas y mapa · T09 datos de ejemplo · T10 landing · T11 pulido visual y a11y | Develop ⇄ Testing |
| Checkpoint C | flujo completo en local, axe sin violaciones graves | revisa el humano |
| 4. Publicación | T12 GitHub + Vercel · T13 keep-alive · T14 E2E contra producción | **manual guiado** + Testing |
| 5. Entrega | T15 README y comprobación de secretos en el historial · T16 las 4 preguntas | Orquestador + humano |

## Riesgos y mitigaciones
| Riesgo | Impacto | Mitigación |
|---|---|---|
| Los subagentes no se cargan | Alto | Comprobado en T00: Claude Code los detecta en caliente al crear `.claude/agents/*.md` |
| Next 16 cambió APIs (`proxy.ts` en vez de `middleware.ts`, `cookies()` async…) | Medio | Develop consulta la documentación que trae el propio paquete (`node_modules/next/dist/docs`) antes de usar una API |
| La URL pide login de Vercel | Alto (descalifica) | Desactivar Deployment Protection y comprobarlo con `curl` sin cookies y con incógnito del usuario |
| Supabase pausa el proyecto por inactividad | Alto | T13: keep-alive programado |
| Alguien vacía o estropea la cuenta demo compartida | Medio | T09: «Cargar datos de ejemplo» en cuentas vacías. T04: un trigger en la BD impide cambiar el email o la contraseña de la cuenta demo, incluso llamando directamente a la API |
| Una clave acaba subida al repo | Alto | `.gitignore` desde T00, D-xx de secretos y escaneo del historial en T15 |
| Se agota la cuota a mitad | Medio | `TRASPASO.md` al día tras cada tarea |

## Pasos manuales del usuario (te avisaré en su momento, con instrucciones)
1. T04: crear el proyecto de Supabase, ejecutar la migración, desactivar «Confirm email» y pasar la URL y la anon key.
2. T05: crear dos usuarios en Supabase, el demo (para quien evalúe) y uno para el test de RLS.
3. T12: crear el repo `19Jvb/eslabon` e importarlo en Vercel. Poner las variables de entorno y quitar Deployment Protection.
4. T13: añadir los secrets en GitHub.
5. T16: pegar las 4 preguntas.

## Preguntas abiertas
- Las 4 preguntas de la entrega, para T16.
