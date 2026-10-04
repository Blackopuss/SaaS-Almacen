import {
  CircleAlert,
  PackagePlus,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

import { Skeleton } from "./ui/skeleton";

/** Page title area used by every screen. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="max-w-prose text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Explains why a screen is empty and what to do next. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Recoverable error with a clear next step. */
export function ErrorState({
  title = "No pudimos cargar esta sección",
  description = "Revisa tu conexión e inténtalo de nuevo. Tus datos no se modificaron.",
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-xl border bg-card px-6 py-14 text-center"
    >
      <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert aria-hidden="true" className="size-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Placeholder with the shape of a page header and table while loading. */
export function LoadingState({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Cargando…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <div className="space-y-3 rounded-xl border bg-card p-4">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Standard page padding and width. */
export function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 md:py-10">
      {children}
    </div>
  );
}

/** Shown instead of a screen the roles of the person do not allow (USR-09). */
export function NoAccessState({
  title = "No tienes acceso a esta sección",
  description = "Tu rol no incluye esta parte de la empresa. Si la necesitas, pídesela al titular o a un administrador.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border bg-card px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert aria-hidden="true" className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">{title}</h1>
      <p className="mt-1 max-w-sm text-muted-foreground">{description}</p>
    </div>
  );
}

/** Shown instead of a screen of a module the company does not have (MOD-05). */
export function NoModuleState({ module }: { module: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border bg-card px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
        <PackagePlus aria-hidden="true" className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">
        {module} no está activo en tu empresa
      </h1>
      <p className="mt-1 max-w-sm text-muted-foreground">
        Tu plan actual no incluye este módulo. El titular de la empresa puede
        solicitarlo.
      </p>
    </div>
  );
}
