import { ImageResponse } from "next/og";
import { BRAND_COLOR, brandLinks } from "@/app/brand-glyph";

// The drawing reaches 11.75 of its 24 grid from the centre, so at 65% of the side it stays within 32% of it: inside
// the 40% safe circle a maskable icon keeps when the launcher crops it.
const GLYPH_SHARE = 0.65;

// White links on the brand colour, prerendered at build time. «rounded» is the plain icon; «square» fills the whole
// image, for launchers that cut their own shape (maskable, Apple).
export function appIcon(size: number, shape: "rounded" | "square") {
  const side = Math.round(size * GLYPH_SHARE);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_COLOR,
          borderRadius: shape === "rounded" ? "22%" : 0,
        }}
      >
        <svg width={side} height={side} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
          {brandLinks}
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
