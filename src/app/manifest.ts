import type { MetadataRoute } from "next";
import { BRAND_COLOR, BRAND_DESCRIPTION } from "@/app/brand-glyph";

// Enough to install the app; no service worker, so nothing private is cached offline.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Eslabón",
    short_name: "Eslabón",
    description: BRAND_DESCRIPTION,
    lang: "es",
    start_url: "/app",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: BRAND_COLOR,
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
