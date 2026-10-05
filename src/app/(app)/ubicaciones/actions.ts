"use server";

import { revalidatePath } from "next/cache";

import { isAppError } from "@/lib";
import {
  archiveLocation,
  createLocation,
  moveLocation,
  renameLocation,
  restoreLocation,
  type LocationField,
  type LocationResult,
} from "@/platform/locations";
import { requireOrganizationContext } from "@/platform/tenancy";

const LOCATIONS_PATH = "/ubicaciones";

export type LocationFormState = {
  /** True right after the change was applied (the dialog closes). */
  done?: boolean;
  fieldErrors: Partial<Record<LocationField, string>>;
  formError?: string;
  values: { name: string; kind: string; parentId: string };
};

export type LocationActionResult = { ok: true } | { ok: false; error: string };

/**
 * Runs a change with the person and the company of the session (never
 * from the form) and turns "not allowed" into a message.
 */
async function change(
  run: (actor: {
    organizationId: string;
    userId: string;
  }) => Promise<LocationResult>,
): Promise<LocationResult> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const result = await run({
      organizationId: organization.id,
      userId: user.id,
    });
    if (result.ok) revalidatePath(LOCATIONS_PATH);
    return result;
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return {
        ok: false,
        reason: "not_allowed",
        fieldErrors: {},
        formError: error.message,
      };
    }
    throw error;
  }
}

const formState = (
  result: LocationResult,
  values: LocationFormState["values"],
): LocationFormState =>
  result.ok
    ? { done: true, fieldErrors: {}, values }
    : {
        fieldErrors: result.fieldErrors,
        formError: result.formError,
        values,
      };

const simple = (result: LocationResult): LocationActionResult =>
  result.ok
    ? { ok: true }
    : {
        ok: false,
        error:
          result.formError ??
          Object.values(result.fieldErrors)[0] ??
          "No se pudo aplicar el cambio.",
      };

const text = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "");

/** Adds a zone, aisle or shelf. */
export async function createLocationAction(
  _prev: LocationFormState,
  formData: FormData,
): Promise<LocationFormState> {
  const values = {
    name: text(formData, "name"),
    kind: text(formData, "kind"),
    parentId: text(formData, "parentId"),
  };
  return formState(await change((actor) => createLocation(actor, values)), {
    ...values,
    // Ready for the next one in the same place.
    name: "",
  });
}

/** Renames a location. Its id is bound by the page and looked for only
 * inside the company of the session. */
export async function renameLocationAction(
  locationId: string,
  _prev: LocationFormState,
  formData: FormData,
): Promise<LocationFormState> {
  const values = { name: text(formData, "name"), kind: "", parentId: "" };
  return formState(
    await change((actor) =>
      renameLocation(actor, String(locationId), { name: values.name }),
    ),
    values,
  );
}

/** Moves a location into another one, or to the facility itself. */
export async function moveLocationAction(
  locationId: string,
  _prev: LocationFormState,
  formData: FormData,
): Promise<LocationFormState> {
  const values = { name: "", kind: "", parentId: text(formData, "parentId") };
  return formState(
    await change((actor) =>
      moveLocation(actor, String(locationId), { parentId: values.parentId }),
    ),
    values,
  );
}

export async function archiveLocationAction(
  locationId: string,
): Promise<LocationActionResult> {
  return simple(
    await change((actor) => archiveLocation(actor, String(locationId))),
  );
}

export async function restoreLocationAction(
  locationId: string,
): Promise<LocationActionResult> {
  return simple(
    await change((actor) => restoreLocation(actor, String(locationId))),
  );
}
