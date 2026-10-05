"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  IMPORT_COLUMNS,
  saveImportMapping,
  startImport,
  type ImportColumnKey,
} from "@/modules/inventory";
import { requireOrganizationContext } from "@/platform/tenancy";

export type UploadState = { error?: string };

/** What the file input may send at most; the service checks the real limit. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Receives the spreadsheet to import (IMP-04). Person and company come
 * from the session; the file is kept as a private file of that company
 * and read as text.
 */
export async function startImportAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const { user, organization } = await requireOrganizationContext();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Elige el archivo que quieres importar (.xlsx o .csv)." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: "El archivo pesa más de 10 MB. Divídelo en varios." };
  }
  let result;
  try {
    result = await startImport(
      { organizationId: organization.id, userId: user.id },
      { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { error: error.message };
    }
    throw error;
  }
  if (!result.ok) return { error: result.error };
  revalidatePath("/inventario/importar");
  redirect(`/inventario/importar/${result.importId}`);
}

export type MappingState = {
  fieldErrors: Partial<Record<ImportColumnKey | "decimalSeparator", string>>;
  formError?: string;
  saved?: boolean;
  /** What the person had chosen, to show it again after a refusal. */
  values: { mapping: Record<string, string>; decimalSeparator: string };
};

/**
 * Saves which column of the file is each of ours and how decimals are
 * written. The import is looked for only inside the company of the
 * session.
 */
export async function saveMappingAction(
  importId: string,
  _prev: MappingState,
  formData: FormData,
): Promise<MappingState> {
  const { user, organization } = await requireOrganizationContext();
  const mapping: Record<string, string> = {};
  for (const column of IMPORT_COLUMNS) {
    mapping[column.key] = String(formData.get(`column.${column.key}`) ?? "")
      .trim()
      .slice(0, 4);
  }
  const values = {
    mapping,
    decimalSeparator: String(formData.get("decimalSeparator") ?? "").slice(
      0,
      1,
    ),
  };
  let result;
  try {
    result = await saveImportMapping(
      { organizationId: organization.id, userId: user.id },
      {
        importId: String(importId),
        mapping,
        decimalSeparator: values.decimalSeparator,
      },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { fieldErrors: {}, formError: error.message, values };
    }
    throw error;
  }
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError:
        result.formError ??
        "Revisa lo marcado abajo: todavía no se guardó nada.",
      values,
    };
  }
  revalidatePath(`/inventario/importar/${String(importId)}`);
  return { fieldErrors: {}, saved: true, values };
}
