"use client";

import {
  Archive,
  ArchiveRestore,
  CircleAlert,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import {
  archiveLocationAction,
  createLocationAction,
  moveLocationAction,
  renameLocationAction,
  restoreLocationAction,
  type LocationFormState,
} from "./actions";

/** A place where a location can go, with the kinds it accepts (built in the server). */
export type PlaceOption = {
  /** "" = directly in the facility. */
  id: string;
  label: string;
  kinds: { value: string; label: string }[];
};

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      {message}
    </div>
  );
}

function Submit({
  pending,
  children,
  busy,
}: {
  pending: boolean;
  children: string;
  busy: string;
}) {
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
      {pending ? busy : children}
    </Button>
  );
}

/**
 * Adds a zone, aisle or shelf. The person first says where it goes; the
 * kinds offered are the ones that fit there.
 */
export function AddLocationDialog({
  places,
  insideId = "",
  insideName,
}: {
  places: PlaceOption[];
  /** Place preselected when the dialog opens from a row. */
  insideId?: string;
  /** Name of that row: the trigger becomes its small «add inside» button. */
  insideName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placeId, setPlaceId] = useState(insideId);
  // React resets a form after its action; the answers count how many came
  // back so the select is rebuilt showing the place the person had chosen.
  const [answers, setAnswers] = useState(0);
  const [state, formAction, pending] = useActionState(
    async (prev: LocationFormState, formData: FormData) => {
      const next = await createLocationAction(prev, formData);
      setAnswers((count) => count + 1);
      if (next.done) {
        toast.success("Ubicación agregada.");
        setOpen(false);
      }
      return next;
    },
    {
      fieldErrors: {},
      values: { name: "", kind: "", parentId: insideId },
    } satisfies LocationFormState,
  );
  const place = places.find((option) => option.id === placeId) ?? places[0];
  const kinds = place?.kinds ?? [];
  const prefix = `add-${insideId || "root"}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {insideName ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Agregar dentro de ${insideName}`}
          >
            <Plus aria-hidden="true" />
          </Button>
        ) : (
          <Button>
            <Plus aria-hidden="true" data-icon="inline-start" />
            Agregar ubicación
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar ubicación</DialogTitle>
          <DialogDescription>
            Ponle el nombre que usan en tu negocio. Una zona puede tener
            pasillos y estantes; un pasillo, estantes.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} noValidate className="space-y-5">
          <FormError message={state.formError} />
          <FormField
            id={`${prefix}-parent`}
            label="¿Dónde va?"
            error={state.fieldErrors.parentId}
          >
            {(control) => (
              <NativeSelect
                {...control}
                name="parentId"
                defaultValue={placeId}
                key={`place-${answers}`}
                onChange={(event) => setPlaceId(event.target.value)}
              >
                {places.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id={`${prefix}-kind`}
            label="¿Qué es?"
            error={state.fieldErrors.kind}
          >
            {(control) => (
              <NativeSelect
                {...control}
                name="kind"
                defaultValue={
                  kinds.some((kind) => kind.value === state.values.kind)
                    ? state.values.kind
                    : kinds[0]?.value
                }
                // The kinds depend on the place: start over when it changes.
                key={`${placeId}-${state.values.kind}-${answers}`}
              >
                {kinds.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id={`${prefix}-name`}
            label="Nombre"
            hint="Por ejemplo: Bodega, Pasillo 3, Estante A."
            error={state.fieldErrors.name}
          >
            {(control) => (
              <Input
                {...control}
                name="name"
                defaultValue={state.values.name}
                key={`name-${state.values.name}-${String(state.done)}`}
                maxLength={60}
                autoComplete="off"
                required
              />
            )}
          </FormField>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Submit pending={pending} busy="Guardando…">
              Agregar
            </Submit>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rename, move or archive one location. */
export function EditLocationDialog({
  location,
  destinations,
  canUpdate,
  canArchive,
}: {
  location: {
    id: string;
    name: string;
    kindLabel: string;
    parentId: string;
    /** Locations directly inside it. */
    children: number;
  };
  /** Places this location could be moved to (its current one included). */
  destinations: { id: string; label: string }[];
  canUpdate: boolean;
  canArchive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const empty: LocationFormState = {
    fieldErrors: {},
    values: { name: location.name, kind: "", parentId: location.parentId },
  };
  const [renameState, renameAction, renaming] = useActionState(
    async (prev: LocationFormState, formData: FormData) => {
      const next = await renameLocationAction(location.id, prev, formData);
      if (next.done) {
        toast.success("Nombre cambiado.");
        setOpen(false);
      }
      return next;
    },
    empty,
  );
  const [moveState, moveAction, moving] = useActionState(
    async (prev: LocationFormState, formData: FormData) => {
      const next = await moveLocationAction(location.id, prev, formData);
      if (next.done) {
        toast.success(`${location.name} se movió.`);
        setOpen(false);
      }
      return next;
    },
    empty,
  );
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiving, startArchive] = useTransition();

  function archive() {
    setArchiveError(null);
    startArchive(async () => {
      const result = await archiveLocationAction(location.id);
      if (result.ok) {
        toast.success(`${location.name} se archivó.`);
        setOpen(false);
      } else {
        setArchiveError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Cambiar ${location.name}`}
        >
          <Pencil aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{location.name}</DialogTitle>
          <DialogDescription>
            {location.kindLabel}.{" "}
            {location.children === 0
              ? "No tiene ubicaciones dentro."
              : location.children === 1
                ? "Tiene una ubicación dentro."
                : `Tiene ${location.children} ubicaciones dentro.`}
          </DialogDescription>
        </DialogHeader>
        {canUpdate && (
          <form action={renameAction} noValidate className="space-y-3">
            <FormError message={renameState.formError} />
            <FormField
              id={`rename-${location.id}`}
              label="Nombre"
              error={renameState.fieldErrors.name}
            >
              {(control) => (
                <Input
                  {...control}
                  name="name"
                  defaultValue={renameState.values.name}
                  key={`name-${renameState.values.name}`}
                  maxLength={60}
                  autoComplete="off"
                  required
                />
              )}
            </FormField>
            <Submit pending={renaming} busy="Guardando…">
              Cambiar nombre
            </Submit>
          </form>
        )}
        {canUpdate && destinations.length > 1 && (
          <form
            action={moveAction}
            noValidate
            className="space-y-3 border-t pt-5"
          >
            <FormError message={moveState.formError} />
            <FormField
              id={`move-${location.id}`}
              label="Mover a"
              hint={
                location.children > 0
                  ? "Se mueve con todo lo que tiene dentro."
                  : undefined
              }
              error={moveState.fieldErrors.parentId}
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  name="parentId"
                  defaultValue={moveState.values.parentId}
                  key={`place-${moveState.values.parentId}`}
                >
                  {destinations.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <Submit pending={moving} busy="Moviendo…">
              Mover
            </Submit>
          </form>
        )}
        {canArchive && (
          <div className="space-y-3 border-t pt-5">
            <p className="text-sm text-muted-foreground">
              Archivarla la quita de tus listas sin borrar su historial. Puedes
              reactivarla después.
            </p>
            {archiveError && (
              <p role="alert" className="text-sm text-destructive">
                {archiveError}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={archive}
              disabled={archiving}
            >
              {archiving ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Archive aria-hidden="true" data-icon="inline-start" />
              )}
              {archiving ? "Archivando…" : "Archivar ubicación"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Brings an archived location back. */
export function RestoreLocation({
  locationId,
  name,
}: {
  locationId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();

  function restore() {
    startTransition(async () => {
      const result = await restoreLocationAction(locationId);
      if (result.ok) toast.success(`${name} volvió a tus ubicaciones.`);
      else toast.error(result.error);
    });
  }

  return (
    <Button
      variant="outline"
      onClick={restore}
      disabled={pending}
      aria-label={`Reactivar ${name}`}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        <ArchiveRestore aria-hidden="true" data-icon="inline-start" />
      )}
      Reactivar
    </Button>
  );
}
