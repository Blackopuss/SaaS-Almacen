import {
  Columns3,
  LayoutGrid,
  MapPin,
  Rows3,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  EmptyState,
  ErrorState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { Badge } from "@/components/ui/badge";
import { getModuleAccess } from "@/platform/billing";
import {
  LOCATION_KIND_LABELS,
  canContain,
  kindsInside,
  listLocations,
  type AnyLocationKind,
} from "@/platform/locations";

import {
  AddLocationDialog,
  EditLocationDialog,
  RestoreLocation,
  type PlaceOption,
} from "./location-dialogs";

export const metadata: Metadata = { title: "Ubicaciones" };

const KIND_ICONS: Record<AnyLocationKind, LucideIcon> = {
  GENERAL: MapPin,
  ZONE: LayoutGrid,
  AISLE: Columns3,
  SHELF: Rows3,
};

/** Left padding of a row by its depth in the tree (kinds bound it to 2). */
const INDENT = ["", "pl-10 sm:pl-12", "pl-16 sm:pl-20"];

/** Zones, aisles and shelves of the facility (INV-13/14). */
export default async function UbicacionesPage({
  searchParams,
}: PageProps<"/ubicaciones">) {
  const access = await getModuleAccess();
  if (!access.can("inventory.location.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("inventory");
  if (moduleState === "none") {
    return (
      <PageContainer>
        <NoModuleState module="Inventario" />
      </PageContainer>
    );
  }
  const showArchived = (await searchParams).archivadas === "1";
  const tree = await listLocations(
    { organizationId: access.organization.id, userId: access.user.id },
    { includeArchived: showArchived },
  );
  if (!tree) {
    return (
      <PageContainer>
        <PageHeader
          title="Ubicaciones"
          description="Dónde está cada cosa en tu negocio."
        />
        <ErrorState description="No encontramos la ubicación inicial de tu empresa. Contacta a soporte para completar su configuración." />
      </PageContainer>
    );
  }

  // Actions appear only for who may use them and while the plan allows it.
  const canCreate = access.allows("inventory.location.create");
  const canUpdate = access.allows("inventory.location.update");
  const canArchive = access.allows("inventory.location.archive");
  const active = tree.locations.filter((location) => !location.archived);
  const archived = tree.locations.filter((location) => location.archived);
  const facilityPlace = `Directamente en ${tree.facility.name}`;
  const kindOptions = (kind: AnyLocationKind | null) =>
    kindsInside(kind).map((value) => ({
      value,
      label: LOCATION_KIND_LABELS[value],
    }));
  /** Where something new can go: the facility and whatever holds others. */
  const places: PlaceOption[] = [
    { id: "", label: facilityPlace, kinds: kindOptions(null) },
    ...active
      .filter((location) => kindsInside(location.kind).length > 0)
      .map((location) => ({
        id: location.id,
        label: location.path,
        kinds: kindOptions(location.kind),
      })),
  ];
  /** Where a location of this kind fits; what it contains is always finer. */
  const destinationsFor = (kind: AnyLocationKind) => [
    { id: "", label: facilityPlace },
    ...active
      .filter((location) => canContain(location.kind, kind))
      .map((location) => ({ id: location.id, label: location.path })),
  ];
  const list = showArchived ? archived : active;

  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Ubicaciones"
        description="Dónde está cada cosa en tu negocio: zonas, pasillos y estantes."
        actions={
          canCreate && !showArchived ? (
            <AddLocationDialog places={places} />
          ) : undefined
        }
      />
      <p>
        <Link
          href={showArchived ? "/ubicaciones" : "/ubicaciones?archivadas=1"}
          className="inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {showArchived
            ? "Ver ubicaciones activas"
            : "Ver ubicaciones archivadas"}
        </Link>
      </p>
      {showArchived && archived.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No hay ubicaciones archivadas"
          description="Las ubicaciones que archives aparecerán aquí y podrás reactivarlas."
        />
      ) : (
        <section
          aria-labelledby="facility-heading"
          className="rounded-xl border bg-card text-card-foreground"
        >
          <div className="border-b p-4 sm:px-5">
            <p className="text-sm text-muted-foreground">
              {showArchived ? "Archivadas de la instalación" : "Instalación"}
            </p>
            <h2
              id="facility-heading"
              className="mt-1 text-lg font-semibold text-balance break-words"
            >
              {tree.facility.name}
            </h2>
          </div>
          <ul className="divide-y">
            {list.map((location) => {
              const Icon = KIND_ICONS[location.kind];
              const holds = kindsInside(location.kind).length > 0;
              return (
                <li
                  key={location.id}
                  className={`flex min-h-16 items-center gap-3 p-4 sm:px-5 ${
                    showArchived ? "" : (INDENT[location.depth] ?? INDENT[2])
                  }`}
                >
                  <Icon
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium break-words">
                      {showArchived ? location.path : location.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {location.isDefault
                        ? "Ubicación inicial: aquí llega lo que aún no acomodas."
                        : LOCATION_KIND_LABELS[location.kind]}
                    </p>
                  </div>
                  {location.isDefault && (
                    <Badge variant="secondary">Fija</Badge>
                  )}
                  {showArchived && canArchive && (
                    <RestoreLocation
                      locationId={location.id}
                      name={location.name}
                    />
                  )}
                  {!showArchived && !location.isDefault && (
                    <div className="flex shrink-0 items-center gap-1">
                      {canCreate && holds && (
                        <AddLocationDialog
                          places={places}
                          insideId={location.id}
                          insideName={location.name}
                        />
                      )}
                      {(canUpdate || canArchive) && (
                        <EditLocationDialog
                          location={{
                            id: location.id,
                            name: location.name,
                            kindLabel: LOCATION_KIND_LABELS[location.kind],
                            parentId: location.parentId ?? "",
                            children: location.children,
                          }}
                          destinations={destinationsFor(location.kind)}
                          canUpdate={canUpdate}
                          canArchive={canArchive}
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {!showArchived && active.length === 1 && (
            <p className="border-t p-4 text-sm text-muted-foreground sm:px-5">
              {canCreate
                ? "Puedes trabajar solo con «General» o agregar tus zonas, pasillos y estantes cuando quieras."
                : "Tu negocio todavía no tiene zonas, pasillos ni estantes: todo está en «General»."}
            </p>
          )}
        </section>
      )}
    </PageContainer>
  );
}
