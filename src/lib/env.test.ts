import { describe, expect, it } from "vitest";
import { requireEnv } from "@/lib/env";

describe("requireEnv", () => {
  it("devuelve el valor si la variable existe", () => {
    expect(requireEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321")).toBe(
      "http://localhost:54321",
    );
  });

  it("lanza un error que nombra la variable si falta", () => {
    expect(() => requireEnv("DEMO_EMAIL", undefined)).toThrow(
      "Falta la variable de entorno DEMO_EMAIL",
    );
  });

  it("trata una variable vacía o solo con espacios como ausente", () => {
    expect(() => requireEnv("DEMO_PASSWORD", "")).toThrow("DEMO_PASSWORD");
    expect(() => requireEnv("DEMO_PASSWORD", "   ")).toThrow("DEMO_PASSWORD");
  });
});
