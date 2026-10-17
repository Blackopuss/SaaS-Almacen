import type { Metadata } from "next";

import { WarehouseCard } from "@/components";
import { PASSWORD_MIN_LENGTH } from "@/platform/auth";

import { InvalidLink, ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "Nueva contraseña",
  // The reset token travels in the URL: never send it to other sites.
  referrer: "no-referrer",
  robots: { index: false },
};

/**
 * Landing page of the reset link. Better Auth checks the token first and
 * adds ?token=... when it is valid or ?error=INVALID_TOKEN when it is not.
 */
export default async function RestablecerContrasenaPage({
  searchParams,
}: PageProps<"/restablecer-contrasena">) {
  const { token, error } = await searchParams;
  const valid = typeof token === "string" && token.length > 0 && !error;

  return (
    <WarehouseCard>
      {valid ? (
        <ResetForm token={token} minLength={PASSWORD_MIN_LENGTH} />
      ) : (
        <InvalidLink />
      )}
    </WarehouseCard>
  );
}
