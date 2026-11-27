// Shared Tailwind classes: one focus ring, one button base and one text input for every page.
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";
// Pressing gives way a little (no movement with reduced motion).
export const buttonBase = `inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.97] ${focusRing}`;
export const inputClass = `min-h-11 w-full rounded-lg border border-neutral-400 bg-white px-3 text-base text-neutral-900 aria-invalid:border-red-700 ${focusRing}`;
