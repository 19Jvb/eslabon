"use client";

import { useActionState } from "react";
import { signInDemo } from "@/app/(auth)/actions";
import { Spinner } from "@/app/spinner";
import { buttonBase } from "@/app/ui";
import { GENERIC_ERROR } from "@/lib/auth";
import { withFallback } from "@/lib/with-fallback";

const demoAction = withFallback(signInDemo, { error: GENERIC_ERROR });

// The state lives in the caller so a page can also disable its other buttons while the demo signs in.
export function useDemoSignIn() {
  return useActionState(demoAction, null);
}

// disabled: the page's other action is running (the button is always disabled while its own runs).
type DemoFormProps = { demo: ReturnType<typeof useDemoSignIn>; disabled?: boolean; className: string };

export function DemoForm({ demo: [state, tryDemo, pending], disabled, className }: DemoFormProps) {
  return (
    <form action={tryDemo} className="flex flex-col gap-2">
      <button type="submit" disabled={pending || disabled} className={`${buttonBase} w-full ${className}`}>
        {pending && <Spinner />}
        Probar con la cuenta demo
      </button>
      {state && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function DemoButton({ className }: { className: string }) {
  return <DemoForm demo={useDemoSignIn()} className={className} />;
}
