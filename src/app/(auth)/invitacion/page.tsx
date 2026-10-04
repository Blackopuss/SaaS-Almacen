import type { Metadata } from "next";

import { WarehouseCard } from "@/components";
import { PASSWORD_MIN_LENGTH, getCurrentSession } from "@/platform/auth";
import {
  INVITATION_PATH,
  ROLE_LABELS,
  previewInvitation,
} from "@/platform/authorization";

import {
  AcceptForm,
  InvalidInvitation,
  JoinForm,
  SignInFirst,
  WrongAccount,
} from "./invitation-forms";

export const metadata: Metadata = {
  title: "Invitación",
  // The invitation token travels in the URL: never send it to other sites.
  referrer: "no-referrer",
  robots: { index: false },
};

/** Landing page of the invitation link (USR-05). */
export default async function InvitacionPage({
  searchParams,
}: PageProps<"/invitacion">) {
  const { token } = await searchParams;
  const invitation =
    typeof token === "string" ? await previewInvitation(token) : null;

  if (!invitation || typeof token !== "string") {
    return (
      <WarehouseCard>
        <InvalidInvitation />
      </WarehouseCard>
    );
  }

  const session = await getCurrentSession();
  const summary = {
    organizationName: invitation.organizationName,
    email: invitation.email,
    roles: invitation.roles.map((role) => ROLE_LABELS[role]),
  };

  return (
    <WarehouseCard>
      {session ? (
        session.user.email.toLowerCase() === invitation.email ? (
          <AcceptForm token={token} invitation={summary} />
        ) : (
          <WrongAccount
            token={token}
            invitation={summary}
            currentEmail={session.user.email}
          />
        )
      ) : invitation.hasAccount ? (
        <SignInFirst
          invitation={summary}
          signInHref={`/ingresar?siguiente=${encodeURIComponent(`${INVITATION_PATH}?token=${token}`)}`}
        />
      ) : (
        <JoinForm
          token={token}
          invitation={summary}
          minLength={PASSWORD_MIN_LENGTH}
        />
      )}
    </WarehouseCard>
  );
}
