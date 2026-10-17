import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageContainer, PageHeader } from "@/components";
import { formatDate } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import {
  PROPOSED_TIERS,
  getCompanyPlan,
  requirePlatformStaff,
} from "@/platform/billing";

import { provisionAction } from "./actions";
import { ProvisionForm } from "./provision-form";

export const metadata: Metadata = { title: "Plan de la empresa" };

/** Plan of one company and the form to assign it (MOD-09). */
export default async function EmpresaInternaPage({
  params,
}: PageProps<"/interno/empresas/[id]">) {
  await requirePlatformStaff();
  const { id } = await params;
  const company = await getCompanyPlan(id);
  if (!company) notFound();

  const moduleNames = moduleRegistry.all
    .filter((m) => company.modules.includes(m.id))
    .map((m) => m.name);
  const facts: [string, string][] = [
    ["Titular", `${company.ownerName} · ${company.ownerEmail}`],
    ["Módulos activos", moduleNames.join(", ") || "Ninguno"],
    [
      "Productos",
      company.productLimit === null
        ? "Sin cupo asignado"
        : `${company.productsUsed} de ${company.productLimit}`,
    ],
    [
      "Usuarios",
      company.users === null
        ? `${company.activeMembers} activos, sin cupo asignado`
        : `${company.activeMembers} de ${company.users}`,
    ],
    [
      "Vigencia",
      company.validUntil
        ? `Hasta el ${formatDate(company.validUntil)}`
        : company.modules.length > 0
          ? "Sin fecha de término"
          : "Sin plan",
    ],
  ];

  return (
    <PageContainer>
      <Link
        href="/interno"
        className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Empresas
      </Link>
      <PageHeader
        title={company.name}
        description={`Empresa creada el ${formatDate(company.createdAt)}.`}
      />

      <section
        aria-labelledby="plan-actual"
        className="rounded-xl border bg-card p-4 sm:p-5"
      >
        <h2 id="plan-actual" className="font-medium">
          Plan actual
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {facts.map(([term, value]) => (
            <div key={term}>
              <dt className="text-sm text-muted-foreground">{term}</dt>
              <dd className="font-medium [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <ProvisionForm
        action={provisionAction.bind(null, company.id)}
        modules={moduleRegistry.available.map((m) => ({
          id: m.id,
          name: m.name,
          required: m.required,
          needs: moduleRegistry.dependenciesOf(m.id).map((d) => d.name),
        }))}
        tiers={PROPOSED_TIERS.map((tier) => ({ ...tier }))}
        current={{
          productLimit: company.productLimit,
          users: company.users,
          modules: company.modules,
          validUntil: company.validUntil
            ? company.validUntil.toISOString()
            : null,
        }}
      />
    </PageContainer>
  );
}
