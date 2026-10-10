"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  cancelExitImport,
  confirmExitImport,
  startExitImport,
} from "@/modules/inventory";
import { requireOrganizationContext } from "@/platform/tenancy";

export type ExitUploadState = {
  error?: string;
  separatorError?: string;
  /** What the person had chosen, to show it again after a refusal. */
  decimalSeparator?: string;
  /** Changes with every answer, so the select shows what was chosen. */
  answers?: number;
};

/** What the file input may send at most; the service checks the real limit. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Receives a file of daily exits (IMP-10). Person and company come from
 * the session; the file is kept as a private file of that company and
 * read as text. Nothing leaves stock until it is confirmed.
 */
export async function startExitImportAction(
  prev: ExitUploadState,
  formData: FormData,
): Promise<ExitUploadState> {
  const { user, organization } = await requireOrganizationContext();
  const decimalSeparator = String(formData.get("decimalSeparator") ?? "").slice(
    0,
    1,
  );
  const answer = { decimalSeparator, answers: (prev.answers ?? 0) + 1 };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...answer, error: "Elige el archivo de salidas (.csv o .xlsx)." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ...answer,
      error: "El archivo pesa más de 10 MB. Divídelo en varios.",
    };
  }
  let result;
  try {
    result = await startExitImport(
      { organizationId: organization.id, userId: user.id },
      {
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        decimalSeparator,
      },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ...answer, error: error.message };
    }
    throw error;
  }
  if (!result.ok) {
    return result.reason === "separator"
      ? { ...answer, separatorError: result.error }
      : { ...answer, error: result.error };
  }
  revalidatePath("/inventario/importar/salidas");
  redirect(`/inventario/importar/salidas/${result.importId}`);
}

export type ExitImportActionState =
  { ok: true; message: string } | { ok: false; error: string };

const refresh = (importId: string) => {
  revalidatePath("/inventario/importar/salidas");
  revalidatePath(`/inventario/importar/salidas/${importId}`);
};

/**
 * Confirms a file of exits: its rows are fixed and queued to leave stock.
 * The import is looked for only inside the company of the session;
 * sending it twice confirms once.
 */
export async function confirmExitImportAction(
  importId: string,
): Promise<ExitImportActionState> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const result = await confirmExitImport(
      { organizationId: organization.id, userId: user.id },
      String(importId),
    );
    if (!result.ok) return { ok: false, error: result.error };
    refresh(String(importId));
    return {
      ok: true,
      message:
        result.rows === 1
          ? "Confirmada: se registrará 1 salida."
          : `Confirmada: se registrarán ${result.rows.toLocaleString("es-MX")} salidas.`,
    };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/**
 * Cancels an import of exits: what was registered stays, the rest is not
 * registered. Looked for only inside the company of the session.
 */
export async function cancelExitImportAction(
  importId: string,
): Promise<ExitImportActionState> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const result = await cancelExitImport(
      { organizationId: organization.id, userId: user.id },
      String(importId),
    );
    if (!result.ok) return { ok: false, error: result.error };
    refresh(String(importId));
    return {
      ok: true,
      message:
        result.applied === 0
          ? "Importación cancelada. No salió nada de tu inventario."
          : result.applied === 1
            ? "Importación cancelada. La salida que ya se había registrado se queda."
            : `Importación cancelada. Las ${result.applied.toLocaleString("es-MX")} salidas que ya se habían registrado se quedan.`,
    };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
