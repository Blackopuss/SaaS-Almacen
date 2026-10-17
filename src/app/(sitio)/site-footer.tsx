import Link from "next/link";

import { FOOTER_LINKS, SITE } from "./content";
import { Brand } from "./site-header";

/** Footer of the public site: sections, legal documents and copyright. */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <Brand />
          <p className="max-w-xs text-sm text-muted-foreground">
            Inventario y compras para negocios que mueven mercancía. Hecho en
            México, en español.
          </p>
          <a
            href={`mailto:${SITE.contactEmail}`}
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {SITE.contactEmail}
          </a>
        </div>
        {FOOTER_LINKS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="text-sm font-semibold">{group.title}</h2>
            <ul className="mt-3 space-y-1">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground md:min-h-9"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {year} {SITE.name}. Todos los derechos reservados.
          </p>
          <p>Precios en pesos mexicanos (MXN).</p>
        </div>
      </div>
    </footer>
  );
}
