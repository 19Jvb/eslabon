"use client";

import { useActionState } from "react";
import { Spinner } from "@/app/spinner";
import { buttonBase } from "@/app/ui";
import { GENERIC_ERROR } from "@/lib/auth";
import { withFallback } from "@/lib/with-fallback";
import { signOut } from "./actions";

const signOutAction = withFallback(signOut, { error: GENERIC_ERROR });

export function SignOutForm() {
  const [state, submit, pending] = useActionState(signOutAction, null);

  return (
    <form action={submit} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className={`${buttonBase} border border-neutral-400 bg-white text-sm whitespace-nowrap text-neutral-900 hover:bg-neutral-100`}
      >
        {pending && <Spinner />}
        Cerrar sesión
      </button>
      {state && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
