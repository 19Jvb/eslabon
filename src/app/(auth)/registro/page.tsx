import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Crear cuenta</h1>
      <AuthForm mode="registro" />
      <p className="mt-6 text-center text-sm text-neutral-700">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-emerald-800 underline underline-offset-2">
          Entrar
        </Link>
      </p>
    </>
  );
}
