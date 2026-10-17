import { AppShell, visibleNavItems } from "@/components";
import { isPermission } from "@/platform/authorization";
import { getModuleAccess } from "@/platform/billing";
import { listMyOrganizations } from "@/platform/tenancy";

import { signOutAction, switchOrganizationAction } from "./actions";

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
      {children}
    </AppShell>
  );
}
