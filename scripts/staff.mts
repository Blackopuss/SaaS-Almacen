// Platform staff (MOD-09): who may use the internal console (/interno).
// There is no screen to grant this; it is done here, by someone with access
// to the database.
// Usage:
//   npm run staff -- list
//   npm run staff -- add correo@ejemplo.mx
//   npm run staff -- remove correo@ejemplo.mx
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const [command, rawEmail] = process.argv.slice(2);
const email = (rawEmail ?? "").trim().toLowerCase();

// Imported after the environment is loaded.
const { db } = await import("@/server/db");

async function main(): Promise<number> {
  if (command === "list") {
    const rows = await db.platformStaff.findMany({
      include: { user: { select: { email: true, twoFactorEnabled: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (rows.length === 0) console.log("No hay personal de plataforma.");
    for (const row of rows) {
      console.log(
        `${row.user.email}  ${row.disabledAt ? "retirado" : "activo"}  MFA ${row.user.twoFactorEnabled ? "activa" : "pendiente"}`,
      );
    }
    return 0;
  }
  if ((command !== "add" && command !== "remove") || !email) {
    console.error(
      "Uso: npm run staff -- list | add <correo> | remove <correo>",
    );
    return 1;
  }
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No existe una cuenta con el correo ${email}.`);
    return 1;
  }
  if (command === "add") {
    await db.platformStaff.upsert({
      where: { userId: user.id },
      update: { disabledAt: null },
      create: { userId: user.id },
    });
    console.log(
      `${email} ahora es personal de plataforma (base ${process.env.DATABASE_NAME}).` +
        (user.twoFactorEnabled
          ? ""
          : " Debe activar la verificación en dos pasos para entrar a /interno."),
    );
    return 0;
  }
  const updated = await db.platformStaff.updateMany({
    where: { userId: user.id, disabledAt: null },
    data: { disabledAt: new Date() },
  });
  console.log(
    updated.count === 1
      ? `${email} ya no es personal de plataforma.`
      : `${email} no era personal de plataforma.`,
  );
  return 0;
}

const code = await main();
await db.$disconnect();
process.exit(code);
