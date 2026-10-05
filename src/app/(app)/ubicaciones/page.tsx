import { MapPin } from "lucide-react";
import type { Metadata } from "next";

import {
  ErrorState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { getModuleAccess } from "@/platform/billing";
import { getDefaultLocation } from "@/platform/locations";

export const metadata: Metadata = { title: "Ubicaciones" };

export default async function UbicacionesPage() {
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
  const location = await getDefaultLocation({
    organizationId: access.organization.id,
    userId: access.user.id,
  });
  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Ubicaciones"
        description="La instalación y la ubicación de tu inventario."
      />
      {location ? (
        <section
          aria-labelledby="facility-heading"
          className="rounded-xl border bg-card p-6 text-card-foreground"
        >
          <p className="text-sm text-muted-foreground">Instalación</p>
          <h2
            id="facility-heading"
            className="mt-1 text-lg font-semibold text-balance break-words"
          >
            {location.facility.name}
          </h2>
          <div className="mt-6 flex items-start gap-3 border-t pt-5">
            <MapPin
              aria-hidden="true"
              className="mt-1 size-5 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0">
              <h3 className="font-medium break-words">{location.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Ubicación por defecto de tu inventario.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <ErrorState description="No encontramos la ubicación inicial de tu empresa. Contacta a soporte para completar su configuración." />
      )}
    </PageContainer>
  );
}
