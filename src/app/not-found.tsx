import type { Metadata } from "next";
import Link from "next/link";
import { secondaryButton } from "@/app/ui";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-4 px-3 py-8 sm:px-4">
      <h1 className="font-display text-2xl font-semibold text-neutral-900">No encontramos esta página.</h1>
      <Link href="/" className={secondaryButton}>
        Ir al inicio
      </Link>
    </main>
  );
}
