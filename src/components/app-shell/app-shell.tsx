"use client";

import { Ellipsis, LogOut, Warehouse } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { motion, transitions } from "../motion";
import { ThemeToggle } from "../theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { NAV_ITEMS, isActive, type NavItem } from "./nav";
import {
  OrganizationSwitcher,
  type ShellOrganization,
} from "./organization-switcher";

export type ShellUser = { name: string; email: string };
export type { ShellOrganization };

type SwitchAction = (id: string) => Promise<{ error: string }>;

/**
 * Application frame (BAS-13, PLT-04): sidebar on desktop, bottom bar on
 * mobile (4 sections + «Más»), skip link, landmarks, the active company
 * (PLT-11) and the signed-in user with «Cerrar sesión».
 */
export function AppShell({
  children,
  user,
  organization,
  organizations,
  signOutAction,
  switchOrganizationAction,
}: {
  children: React.ReactNode;
  user: ShellUser;
  organization: ShellOrganization;
  organizations: ShellOrganization[];
  signOutAction: () => Promise<void>;
  switchOrganizationAction: SwitchAction;
}) {
  const switcher = (
    <OrganizationSwitcher
      organization={organization}
      organizations={organizations}
      switchOrganizationAction={switchOrganizationAction}
    />
  );
  const pathname = usePathname();
  const primary = NAV_ITEMS.filter((item) => item.mobile);
  const secondary = NAV_ITEMS.filter((item) => !item.mobile);
  const current = NAV_ITEMS.find((item) => isActive(pathname, item.href));

  return (
    <div className="flex min-h-dvh w-full">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Saltar al contenido
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
        <Brand />
        <div className="-mt-2 px-3 pb-2">{switcher}</div>
        <nav aria-label="Principal" className="flex-1 px-3 pb-4">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <SidebarLink
                  item={item}
                  active={isActive(pathname, item.href)}
                />
              </li>
            ))}
          </ul>
        </nav>
        <div className="space-y-2 border-t px-3 py-3">
          <div className="px-1">
            <ThemeToggle showLabel />
          </div>
          <UserBlock user={user} signOutAction={signOutAction} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md md:hidden">
          <Warehouse aria-hidden="true" className="size-5 text-primary" />
          <span className="font-semibold">{current?.label ?? "Almacén"}</span>
          <ThemeToggle className="ml-auto" />
        </header>

        <main
          id="contenido"
          tabIndex={-1}
          className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] outline-none md:pb-0"
        >
          {children}
        </main>
      </div>

      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <ul className="grid grid-cols-5">
          {primary.map((item) => (
            <li key={item.href}>
              <BottomLink item={item} active={isActive(pathname, item.href)} />
            </li>
          ))}
          <li>
            <MoreMenu
              switcher={switcher}
              user={user}
              signOutAction={signOutAction}
              items={secondary}
              active={secondary.some((item) => isActive(pathname, item.href))}
              pathname={pathname}
            />
          </li>
        </ul>
      </nav>
    </div>
  );
}

function Brand() {
  return (
    <Link
      href="/inventario"
      className="m-3 flex h-12 items-center gap-2.5 rounded-lg px-3 font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Warehouse aria-hidden="true" className="size-4.5" />
      </span>
      Almacén
    </Link>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className="relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:text-accent-foreground"
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={transitions.spring}
          className="absolute inset-0 rounded-lg bg-accent"
          aria-hidden="true"
        />
      )}
      <Icon aria-hidden="true" className="relative size-4.5" />
      <span className="relative">{item.label}</span>
    </Link>
  );
}

const bottomItemClass =
  "flex h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset aria-[current=page]:text-primary data-[active=true]:text-primary";

function BottomLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={bottomItemClass}
    >
      <Icon aria-hidden="true" className="size-5" />
      {item.label}
    </Link>
  );
}

function MoreMenu({
  switcher,
  user,
  signOutAction,
  items,
  active,
  pathname,
}: {
  switcher: React.ReactNode;
  user: ShellUser;
  signOutAction: () => Promise<void>;
  items: NavItem[];
  active: boolean;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className={bottomItemClass} data-active={active}>
        <Ellipsis aria-hidden="true" className="size-5" />
        Más
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader>
          <SheetTitle>Más opciones</SheetTitle>
          <SheetDescription className="sr-only">
            Otras secciones de la aplicación
          </SheetDescription>
        </SheetHeader>
        <nav aria-label="Más opciones" className="px-4">
          <ul className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const current = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={current ? "page" : undefined}
                    className="flex h-12 items-center gap-3 rounded-lg px-3 font-medium transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
                  >
                    <Icon aria-hidden="true" className="size-5" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mx-4 space-y-1 border-t pt-3">
          {switcher}
          <UserBlock user={user} signOutAction={signOutAction} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function UserBlock({
  user,
  signOutAction,
}: {
  user: ShellUser;
  signOutAction: () => Promise<void>;
}) {
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex items-center gap-3 rounded-lg px-1 py-1">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
      <form action={signOutAction}>
        <button
          type="submit"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:size-10"
        >
          <LogOut aria-hidden="true" className="size-4.5" />
        </button>
      </form>
    </div>
  );
}
