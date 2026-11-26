import { z } from "zod";

export const GENERIC_ERROR = "No se pudo completar. Inténtalo de nuevo.";
const SHORT_PASSWORD = "La contraseña debe tener al menos 8 caracteres";

// The object-level message covers a body that is not an object: zod's default is English.
export const Credentials = z.object(
  {
    email: z.email("Escribe un email válido"),
    password: z.string("Escribe tu contraseña").min(1, "Escribe tu contraseña"),
  },
  GENERIC_ERROR,
);

// 72 is the bcrypt limit Supabase Auth enforces; 8 matches minimum_password_length in supabase/config.jsonc.
export const NewAccount = Credentials.extend({
  password: z.string(SHORT_PASSWORD).min(8, SHORT_PASSWORD).max(72, "La contraseña puede tener como máximo 72 caracteres"),
});

// Translates by AuthError.code, never by the raw message.
export function authErrorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_credentials":
      return "Email o contraseña incorrectos";
    case "user_already_exists":
    case "email_exists":
      return "Ya existe una cuenta con ese email";
    case "weak_password":
      return SHORT_PASSWORD;
    default:
      return GENERIC_ERROR;
  }
}
