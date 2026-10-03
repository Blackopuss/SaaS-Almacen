import { afterAll, describe, expect, it } from "vitest";

import { registerUser } from "@/platform/auth";
import { db } from "@/server";

// PLT-02: registration with email and password.

const email = `Registro.${Date.now()}@Example.Test`;
const password = "una-frase-larga-y-segura";
const noHeaders = new Headers();

afterAll(async () => {
  await db.$disconnect();
});

describe("registerUser", () => {
  it("creates the account with a normalized email and an OWASP scrypt hash", async () => {
    const result = await registerUser(
      { name: "  Ana Pérez  ", email: `  ${email}  `, password },
      noHeaders,
    );
    expect(result.ok).toBe(true);

    const user = await db.user.findUniqueOrThrow({
      where: { email: email.toLowerCase() },
      include: { accounts: true },
    });
    expect(user.name).toBe("Ana Pérez");
    const hash = user.accounts.find(
      (a) => a.providerId === "credential",
    )?.password;
    expect(hash).toMatch(/^scrypt\$32768\$8\$3\$/);
  });

  it("reports every invalid field in Spanish without creating anything", async () => {
    const before = await db.user.count();
    const result = await registerUser(
      { name: "A", email: "no-es-correo", password: "corta" },
      noHeaders,
    );
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        name: "Escribe tu nombre (mínimo 2 caracteres).",
        email: "Escribe un correo válido, por ejemplo nombre@negocio.mx.",
        password: "La contraseña debe tener al menos 12 caracteres.",
      },
    });
    expect(await db.user.count()).toBe(before);
  });

  it("enforces the length policy (12 to 128 characters)", async () => {
    const tooLong = await registerUser(
      {
        name: "Beto",
        email: `largo.${Date.now()}@example.test`,
        password: "x".repeat(129),
      },
      noHeaders,
    );
    expect(tooLong.ok).toBe(false);
    expect(!tooLong.ok && tooLong.fieldErrors.password).toMatch(/hasta 128/);

    const spaces = await registerUser(
      {
        name: "Beto",
        email: `espacios.${Date.now()}@example.test`,
        password: " ".repeat(12),
      },
      noHeaders,
    );
    expect(!spaces.ok && spaces.fieldErrors.password).toMatch(/espacios/);

    const exact = await registerUser(
      {
        name: "Beto",
        email: `exacta.${Date.now()}@example.test`,
        password: "a".repeat(12),
      },
      noHeaders,
    );
    expect(exact.ok).toBe(true);
  });

  it("rejects a duplicate email (case-insensitive)", async () => {
    const result = await registerUser(
      { name: "Otra Ana", email: email.toUpperCase(), password },
      noHeaders,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors.email).toBe(
      "Ya existe una cuenta con este correo.",
    );
  });
});
