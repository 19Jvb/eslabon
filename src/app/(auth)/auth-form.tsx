"use client";

import { useActionState } from "react";
import { DemoForm, useDemoSignIn } from "@/app/demo-form";
import { Spinner } from "@/app/spinner";
import { buttonBase, inputClass } from "@/app/ui";
import { GENERIC_ERROR } from "@/lib/auth";
import { withFallback } from "@/lib/with-fallback";
import { signIn, signUp } from "./actions";

// A 500 brings no state back from the server, so the fallback keeps the email that was typed.
const keepEmail =
  (action: typeof signIn) =>
  (prev: Parameters<typeof signIn>[0], formData: FormData) =>
    withFallback(action, { error: GENERIC_ERROR, email: String(formData.get("email") ?? "") })(prev, formData);
const submitActions = { login: keepEmail(signIn), registro: keepEmail(signUp) };

export function AuthForm({ mode }: { mode: "login" | "registro" }) {
  const [state, submit, submitting] = useActionState(submitActions[mode], null);
  const demo = useDemoSignIn();
  const [, , demoPending] = demo;
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
        <button type="submit" disabled={submitting || demoPending} className={`${buttonBase} w-full bg-emerald-700 text-white hover:bg-emerald-800`}>
          {submitting && <Spinner />}
          {mode === "login" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>

      <DemoForm demo={demo} disabled={submitting} className="border border-emerald-700 bg-white text-emerald-800 hover:bg-emerald-50" />
    </div>
  );
}
