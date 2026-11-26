"use client";

import { useActionState } from "react";
import { Spinner } from "@/app/spinner";
import { GENERIC_ERROR } from "@/lib/auth";
import { withFallback } from "@/lib/with-fallback";
import { signIn, signInDemo, signUp } from "./actions";

const failed = { error: GENERIC_ERROR };
const submitActions = { login: withFallback(signIn, failed), registro: withFallback(signUp, failed) };
const demoAction = withFallback(signInDemo, failed);

const inputClass =
  "min-h-11 w-full rounded-lg border border-neutral-400 bg-white px-3 text-base text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 aria-invalid:border-red-700";
const buttonClass =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";

export function AuthForm({ mode }: { mode: "login" | "registro" }) {
  const [state, submit, submitting] = useActionState(submitActions[mode], null);
  const [demoState, tryDemo, demoPending] = useActionState(demoAction, null);
  const busy = submitting || demoPending;
  const invalid = (field: "email" | "password") => (state?.field === field ? true : undefined);

  return (
    <div className="flex flex-col gap-6">
      <form action={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state?.email}
            aria-invalid={invalid("email")}
            aria-describedby={state ? "form-error" : undefined}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="font-medium">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            aria-invalid={invalid("password")}
            aria-describedby={[mode === "registro" && "password-hint", state && "form-error"].filter(Boolean).join(" ") || undefined}
            className={inputClass}
          />
          {mode === "registro" && (
            <p id="password-hint" className="text-sm text-neutral-600">
              Al menos 8 caracteres.
            </p>
          )}
        </div>
        {state && (
          <p id="form-error" role="alert" className="text-sm font-medium text-red-700">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={busy} className={`${buttonClass} bg-emerald-700 text-white hover:bg-emerald-800`}>
          {submitting && <Spinner />}
          {mode === "login" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>

      <form action={tryDemo} className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={busy}
          className={`${buttonClass} border border-emerald-700 bg-white text-emerald-800 hover:bg-emerald-50`}
        >
          {demoPending && <Spinner />}
          Probar con la cuenta demo
        </button>
        {demoState && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {demoState.error}
          </p>
        )}
      </form>
    </div>
  );
}
