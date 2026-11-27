// Two chain links, the brand mark; the same drawing is the favicon (icon.svg).
export function BrandGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[1em] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
      <g transform="rotate(-45 12 12)">
        <rect x="1.5" y="8" width="12" height="8" rx="4" />
        <rect x="10.5" y="8" width="12" height="8" rx="4" />
      </g>
    </svg>
  );
}
