import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { BRAND_COLOR, BRAND_DESCRIPTION } from "@/app/brand-glyph";
import "./globals.css";

// Self-hosted at build time by next/font: no request to Google at runtime.
const display = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", variable: "--font-bricolage" });
const body = Instrument_Sans({ subsets: ["latin"], display: "swap", variable: "--font-instrument" });

export const metadata: Metadata = {
  title: { default: "Eslabón", template: "%s · Eslabón" },
  description: BRAND_DESCRIPTION,
};

// The browser bar of the installed app, the same colour as the manifest's theme_color.
export const viewport: Viewport = { themeColor: BRAND_COLOR };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
