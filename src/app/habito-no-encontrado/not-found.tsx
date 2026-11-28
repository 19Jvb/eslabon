import Link from "next/link";
import { BrandName } from "@/app/brand-glyph";
import { secondaryButton } from "@/app/ui";

// The same page for an id that is not a uuid, one that does not exist and someone else's: nothing tells them apart.
export default function HabitNotFound() {
  return (
    <main className="flex flex-1 flex-col bg-neutral-50">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-3 py-8 sm:px-4">
        <BrandName />
        <h1 className="font-display text-2xl font-semibold text-neutral-900">No encontramos ese hábito.</h1>
        <p className="text-neutral-700">Puede que se haya borrado o que el enlace no esté bien.</p>
        <Link href="/app" className={secondaryButton}>
          Tus hábitos
        </Link>
      </div>
    </main>
  );
}
