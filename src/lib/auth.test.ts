import { describe, expect, it } from "vitest";
import { authErrorMessage, Credentials, NewAccount } from "./auth";

const firstError = (result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.error?.issues[0];

describe("Credentials (login)", () => {
  it("accepts a valid email and any non-empty password", () => {
    expect(Credentials.safeParse({ email: "ana@example.com", password: "x" }).success).toBe(true);
  });

  it("rejects an invalid email on the email field", () => {
    const issue = firstError(Credentials.safeParse({ email: "ana", password: "12345678" }));
    expect(issue?.path).toEqual(["email"]);
    expect(issue?.message).toBe("Escribe un email válido");
  });

  it("rejects an empty password", () => {
    const issue = firstError(Credentials.safeParse({ email: "ana@example.com", password: "" }));
    expect(issue?.path).toEqual(["password"]);
  });

  it("rejects missing fields instead of throwing", () => {
    expect(Credentials.safeParse({}).success).toBe(false);
    expect(Credentials.safeParse(undefined).success).toBe(false);
  });
});

describe("NewAccount (registro)", () => {
  it("rejects a 7-character password with the Spanish message", () => {
    const issue = firstError(NewAccount.safeParse({ email: "ana@example.com", password: "1234567" }));
    expect(issue?.path).toEqual(["password"]);
    expect(issue?.message).toBe("La contraseña debe tener al menos 8 caracteres");
  });

  it("accepts exactly 8 and 72 characters, rejects 73", () => {
    expect(NewAccount.safeParse({ email: "ana@example.com", password: "12345678" }).success).toBe(true);
    expect(NewAccount.safeParse({ email: "ana@example.com", password: "a".repeat(72) }).success).toBe(true);
    expect(NewAccount.safeParse({ email: "ana@example.com", password: "a".repeat(73) }).success).toBe(false);
  });
});

describe("authErrorMessage", () => {
  it.each([
    ["invalid_credentials", "Email o contraseña incorrectos"],
    ["user_already_exists", "Ya existe una cuenta con ese email"],
    ["email_exists", "Ya existe una cuenta con ese email"],
    ["weak_password", "La contraseña debe tener al menos 8 caracteres"],
  ])("translates %s", (code, message) => expect(authErrorMessage(code)).toBe(message));

  it.each(["over_request_rate_limit", "unexpected_failure", undefined])(
    "falls back to the generic message for %s",
    (code) => expect(authErrorMessage(code)).toBe("No se pudo completar. Inténtalo de nuevo."),
  );
});
