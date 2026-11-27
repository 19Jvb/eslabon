import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Self-hosted at build time by next/font: no request to Google at runtime.
const display = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", variable: "--font-bricolage" });
const body = Instrument_Sans({ subsets: ["latin"], display: "swap", variable: "--font-instrument" });

export const metadata: Metadata = {
  title: { default: "Eslabón", template: "%s · Eslabón" },
  description: "Crea hábitos diarios, márcalos cada día y no rompas la cadena.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
