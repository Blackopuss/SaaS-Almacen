import { AppShell } from "@/components";
import {
  listMyOrganizations,
  requireOrganizationContext,
} from "@/platform/tenancy";

import { signOutAction, switchOrganizationAction } from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Shows who is signed in and in which company; each page also validates
  // the session and company itself (layouts are not re-run on client
  // navigation).
  const { user, organization } = await requireOrganizationContext();
  const organizations = await listMyOrganizations(user.id);
  return (
    <AppShell
      user={user}
      organization={{ id: organization.id, name: organization.name }}
      organizations={organizations}
      signOutAction={signOutAction}
      switchOrganizationAction={switchOrganizationAction}
    >
      {children}
    </AppShell>
  );
}
