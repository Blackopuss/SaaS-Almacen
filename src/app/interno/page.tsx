import { Building2, ChevronRight, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageContainer, PageHeader } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib";
import {
  listCompaniesForStaff,
  requirePlatformStaff,
} from "@/platform/billing";

export const metadata: Metadata = { title: "Empresas" };

/** Companies to provision (MOD-09). */
export default async function InternoPage({
  searchParams,
}: PageProps<"/interno">) {
  await requirePlatformStaff();
  const { q } = await searchParams;
  const search = typeof q === "string" ? q : "";
  const companies = await listCompaniesForStaff(search);

  return (
    <PageContainer>
      <PageHeader
        title="Empresas"
        description="Asigna el plan de cada empresa: cupo de productos, usuarios, módulos y vigencia."
      />
      <form
        role="search"
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="q">Buscar por nombre o correo del titular</Label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={search}
            autoComplete="off"
            maxLength={120}
          />
        </div>
        <Button type="submit" variant="outline">
          <Search aria-hidden="true" data-icon="inline-start" />
          Buscar
        </Button>
      </form>

      {companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Sin resultados"
          description="No hay empresas con ese nombre o correo."
        />
      ) : (
        <section aria-label="Empresas" className="rounded-xl border bg-card">
          <ul className="divide-y">
            {companies.map((company) => (
              <li key={company.id}>
                <Link
                  href={`/interno/empresas/${company.id}`}
                  className="flex min-h-11 items-center gap-3 p-4 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{company.name}</span>
                    <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      {company.ownerName} · {company.ownerEmail} · desde el{" "}
                      {formatDate(company.createdAt)}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
