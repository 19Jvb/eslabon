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
