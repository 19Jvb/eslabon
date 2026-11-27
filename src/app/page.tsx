import type { Metadata } from "next";
import Link from "next/link";
import { BrandGlyph } from "@/app/brand-glyph";
import { DemoButton } from "@/app/demo-form";
import { ProductPreview } from "@/app/product-preview";
import { buttonBase } from "@/app/ui";

export const metadata: Metadata = {
  title: { absolute: "Eslabón · No rompas la cadena" },
  description: "Crea tus hábitos diarios, márcalos cada día y mira crecer tu racha. Prueba la cuenta demo sin registrarte.",
};

const points = [
  {
    title: "Marca cada día",
    text: "Un toque marca el hábito de hoy. Si se te olvidó, puedes corregir los últimos 7 días.",
  },
  {
    title: "Mira crecer tu racha",
    text: "Tu racha actual, tu mejor racha, el porcentaje de los últimos 30 días y un mapa de 12 semanas.",
  },
  {
    title: "Tus datos son solo tuyos",
    text: "Nadie más ve tus hábitos: cada cuenta solo puede leer y editar los suyos.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-neutral-50">
      <section className="mx-auto w-full max-w-2xl px-4 pt-16 pb-12 text-center sm:pt-24">
        <h1 className="flex items-center justify-center gap-3 text-5xl font-bold tracking-tight text-emerald-800 sm:text-6xl">
          <BrandGlyph />
          Eslabón
        </h1>
        <p className="mt-3 text-xl font-semibold text-neutral-900 sm:text-2xl">No rompas la cadena.</p>
        <p className="mx-auto mt-4 max-w-xl text-lg text-pretty text-neutral-700">
          Crea tus hábitos diarios y márcalos cada día que los cumplas. Cada día cumplido es un eslabón más de tu
          cadena.
        </p>
        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3">
          <DemoButton className="bg-emerald-700 text-white hover:bg-emerald-800" />
          <div className="grid grid-cols-2 gap-3">
            <Link href="/login" className={`${buttonBase} border border-neutral-400 bg-white text-neutral-900 hover:bg-neutral-100`}>
              Entrar
            </Link>
            <Link
              href="/registro"
              className={`${buttonBase} border border-emerald-700 bg-white text-emerald-800 hover:bg-emerald-50`}
            >
              Crear cuenta
            </Link>
          </div>
        </div>
      </section>

      <ProductPreview />

      <ul className="mx-auto grid w-full max-w-4xl gap-6 px-4 pb-14 sm:grid-cols-3 sm:gap-8">
        {points.map((point) => (
          <li key={point.title} className="border-t border-neutral-300 pt-4">
            <h2 className="text-lg font-semibold text-neutral-900">{point.title}</h2>
            <p className="mt-1 text-pretty text-neutral-700">{point.text}</p>
          </li>
        ))}
      </ul>

      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 pb-20 text-center">
        <p className="text-lg text-pretty text-neutral-700">El primer eslabón puede ser el de hoy.</p>
        <Link href="/registro" className={`${buttonBase} bg-emerald-700 text-white hover:bg-emerald-800`}>
          Empieza tu cadena
        </Link>
      </div>
    </main>
  );
}
