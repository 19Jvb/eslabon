// The brand: its colour (theme-color, manifest and icons), its one-line pitch (landing and manifest) and its mark.
export const BRAND_COLOR = "#047857";
export const BRAND_DESCRIPTION =
  "Crea tus hábitos diarios, márcalos cada día y mira crecer tu racha. Prueba la cuenta demo sin registrarte.";

// Two chain links on a 24 grid; the same drawing is the favicon (icon.svg) and the app icons (app-icon.tsx).
export const brandLinks = (
  <g transform="rotate(-45 12 12)">
    <rect x="1.5" y="8" width="12" height="8" rx="4" />
    <rect x="10.5" y="8" width="12" height="8" rx="4" />
  </g>
);

export function BrandGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[1em] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
      {brandLinks}
    </svg>
  );
}

// The name with its mark, as a page header (/app and the 404 pages).
export function BrandName() {
  return (
    <span className="inline-flex items-center gap-2 font-display text-lg font-bold text-emerald-800">
      <BrandGlyph />
      Eslabón
    </span>
  );
}
