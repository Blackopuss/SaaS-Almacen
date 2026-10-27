import { LifeBuoy } from "lucide-react";

import { AppShell, visibleNavItems } from "@/components";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib";
import { isPermission } from "@/platform/authorization";
import { getModuleAccess } from "@/platform/billing";
import { listMyOrganizations } from "@/platform/tenancy";

import {
  leaveSupportAction,
  signOutAction,
  switchOrganizationAction,
} from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Shows who is signed in and in which company; each page also validates
  // the session and company itself (layouts are not re-run on client
  // navigation).
  const access = await getModuleAccess();
  const { user, organization } = access;
  const organizations = await listMyOrganizations(user.id);
  // The menu only offers what the roles of the person allow (USR-09) in
  // modules the company has (MOD-05).
  const allowedHrefs = visibleNavItems(
    (permission) => isPermission(permission) && access.allows(permission),
  ).map((item) => item.href);
  return (
    <AppShell
      user={user}
      organization={{ id: organization.id, name: organization.name }}
      organizations={organizations}
      allowedHrefs={allowedHrefs}
      signOutAction={signOutAction}
      switchOrganizationAction={switchOrganizationAction}
    >
      {/* Support looking in with the titular's leave (PIL-12): always said. */}
      {organization.supportUntil && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm sm:px-6"
        >
          <LifeBuoy aria-hidden="true" className="size-4 shrink-0" />
          <span className="flex-1">
            <span className="font-medium">Modo soporte:</span> solo lectura en{" "}
            {organization.name} hasta el{" "}
            {formatDateTime(organization.supportUntil, organization.timeZone)}
          </span>
          <form action={leaveSupportAction}>
            <Button type="submit" variant="outline">
              Salir
            </Button>
          </form>
        </div>
      )}
      {children}
    </AppShell>
  );
}
