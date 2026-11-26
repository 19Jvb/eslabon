import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Entrar</h1>
      <AuthForm mode="login" />
      <p className="mt-6 text-center text-sm text-neutral-700">
        ¿No tienes cuenta?{" "}
        <Link href="/registro" className="font-medium text-emerald-800 underline underline-offset-2">
          Crear cuenta
        </Link>
      </p>
    </>
  );
}
