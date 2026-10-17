import { TriangleAlert } from "lucide-react";

import { SITE } from "./content";
import { PageHero } from "./sections";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

/**
 * Layout of a legal document: title, draft notice, table of contents (sticky
 * on desktop) and numbered sections. The texts are drafts until a
 * professional reviews them (PIL-08).
 */
export function LegalDocument({
  eyebrow,
  title,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  intro: React.ReactNode;
  sections: LegalSection[];
}) {
  return (
    <>
      <PageHero eyebrow={eyebrow} title={title}>
        Última actualización: {SITE.legalUpdatedAt}
      </PageHero>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[240px_1fr]">
        <nav
          aria-label="Contenido"
          className="lg:sticky lg:top-24 lg:self-start"
        >
          <p className="text-sm font-semibold">Contenido</p>
          <ol className="mt-3 space-y-0.5 border-l text-sm">
            {sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="-ml-px flex min-h-9 items-center border-l-2 border-transparent pl-3 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {index + 1}. {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="max-w-3xl">
          <p
            role="note"
            className="mb-8 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
          >
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            Versión preliminar. Este documento está en revisión profesional
            antes de la apertura del servicio y puede cambiar.
          </p>
          <div className="space-y-4 text-muted-foreground">{intro}</div>
          {sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              className="scroll-mt-24 pt-10"
            >
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {index + 1}. {section.title}
              </h2>
              <div className="mt-3 space-y-3 leading-relaxed text-muted-foreground [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-foreground [&_ul]:space-y-1.5">
                {section.body}
              </div>
            </section>
          ))}
        </article>
      </div>
    </>
  );
}
