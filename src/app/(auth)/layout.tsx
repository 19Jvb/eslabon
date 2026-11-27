import Link from "next/link";
import type { ReactNode } from "react";
import { BrandGlyph } from "@/app/brand-glyph";
import { focusRing } from "@/app/ui";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <header className="mb-6 text-center">
          <Link
            href="/"
            className={`inline-flex min-h-11 items-center gap-2 rounded px-1 font-display text-2xl font-bold text-emerald-800 ${focusRing}`}
          >
            <BrandGlyph />
            Eslabón
          </Link>
          <p className="mt-1 text-sm text-neutral-600">No rompas la cadena.</p>
        </header>
        {children}
      </div>
    </main>
  );
}
