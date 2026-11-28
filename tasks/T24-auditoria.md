# T24: auditoría de seguridad final

Hecha el 2026-11-28 por un agente auditor independiente (`security-auditor`). No pertenece al equipo Develop/Testing y trabajó en solo lectura sobre todo el repo, con comprobaciones GET/POST sin efectos contra producción. Este documento recoge el resultado y el **triaje del Orquestador**.

**Resultado: 0 críticos, 0 altos, 1 medio, 2 bajos y 7 informativos.** El núcleo, formado por la RLS, las funciones `security definer`, el webhook, las Server Actions, el proxy, la caché, los secretos (54 commits revisados), los workflows y las dependencias (`npm audit`: 0), quedó bien.

## Triaje

| ID | Sev. | Hallazgo | Decisión |
|---|---|---|---|
| SEC-1 | Media | Sin cuotas: con la demo o una cuenta nueva se puede llenar por PostgREST el plan gratuito (≈10 M de check-ins) | **Se corrige:** un trigger con un límite de 50 hábitos por usuario. Esto acota los check-ins a unos 490.000 por cuenta |
| SEC-2 | Baja | Login y registro salen desde la IP de Vercel, así que el límite por IP de Supabase lo comparten todos los usuarios | **Se documenta:** riesgo de disponibilidad parcial aceptado. La mitigación es una regla de rate limit en el Firewall de Vercel, que no es código |
| SEC-3 | Baja | Faltan cabeceras contra el enmarcado y el MIME sniffing | **Se corrige:** `X-Frame-Options`, una CSP con `frame-ancestors`/`base-uri`/`form-action`/`object-src`, `nosniff` y `Referrer-Policy`. No se añade `script-src`, porque con Cache Components no se pueden usar nonces |
| SEC-4 | Info | `TELEGRAM_API_BASE` decide a dónde se envía el token del bot | **Se corrige:** en producción se ignora |
| SEC-5 | Info | El mismo secreto sirve para la cabecera del webhook y para `p_secret` | **Se documenta:** el secreto solo lo conocen Telegram y Vercel. Separarlo exigiría otra migración y rotar el secreto |
| SEC-6 | Info | Las cookies de sesión no son `httpOnly` y `client.ts` no se usa | **Se corrige:** `httpOnly` y `secure` en los dos clientes de servidor, y se borra `client.ts` |
| SEC-7 | Info | El tope superior de la policy usa `current_date`, y `Prefer: timezone` lo puede mover | **Se corrige:** el tope pasa a calcularse en UTC |
| SEC-8 | Info | La demo es pública de hecho (contraseña en el README) | **Se documenta:** la prueba pide entregar un usuario y una contraseña. Lo protegen el trigger y la recarga antes de entregar (T15a) |
| SEC-9 | Info | El registro dice si un email ya existe y deja registrar emails ajenos, porque no hay confirmación | **Se documenta:** es una decisión de producto que ya consta en el README (no hay SMTP) |
| SEC-10 | Info | Las Actions se fijan por etiqueta y no por SHA | **Se documenta:** cambiar el CI pide permiso y el riesgo es bajo |
