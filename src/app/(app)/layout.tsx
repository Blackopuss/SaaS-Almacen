import { AppShell } from "@/components";
import { requireOrganizationMember } from "@/platform/tenancy";

import { signOutAction } from "./actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Shows who is signed in; each page also validates the session itself
  // (layouts are not re-run on client navigation).
  const { user } = await requireOrganizationMember();
  return (
    <AppShell user={user} signOutAction={signOutAction}>
      {children}
    </AppShell>
  );
}
