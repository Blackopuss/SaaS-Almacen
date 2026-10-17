import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";

import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { SiteMotion } from "./site-motion";

/**
 * Public site (landing, prices, about, legal). Nothing here reads business
 * data; the session cookie only changes the header's buttons.
 */
export default async function SiteLayout({ children }: LayoutProps<"/">) {
  const signedIn = Boolean(getSessionCookie(await headers()));
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader signedIn={signedIn} />
      <main id="contenido" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <SiteMotion />
    </div>
  );
}
