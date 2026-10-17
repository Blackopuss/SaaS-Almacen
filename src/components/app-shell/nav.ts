import {
  ArrowLeftRight,
  ClipboardCheck,
  House,
  MapPin,
  Package,
  Settings,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Module that must be contracted to show the item (MOD-05); null = always. */
  module: "inventory" | "purchasing" | null;
  /**
   * Permission needed to see the item and open its screen (USR-09), from
   * the catalog in platform/authorization; null = every member.
   */
  permission: string | null;
  /** Shown in the mobile bottom bar (max 4 + «Más»). */
  mobile: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    // Every member lands here; each block inside checks its own permission.
    href: "/inicio",
    label: "Inicio",
    icon: House,
    module: null,
    permission: null,
    mobile: true,
  },
  {
    href: "/inventario",
    label: "Inventario",
    icon: Package,
    module: "inventory",
    permission: "inventory.product.read",
    mobile: true,
  },
  {
    href: "/movimientos",
    label: "Movimientos",
    icon: ArrowLeftRight,
    module: "inventory",
    permission: "inventory.movement.read",
    mobile: true,
  },
  {
    href: "/ubicaciones",
    label: "Ubicaciones",
    icon: MapPin,
    module: "inventory",
    permission: "inventory.location.read",
    // The bottom bar holds four: locations change the least day to day.
    mobile: false,
  },
  {
    href: "/conteos",
    label: "Conteos",
    icon: ClipboardCheck,
    module: "inventory",
    permission: "inventory.count.read",
    mobile: true,
  },
  {
    href: "/compras",
    label: "Compras",
    icon: ShoppingCart,
    module: "purchasing",
    permission: "purchasing.order.read",
    mobile: false,
  },
  {
    href: "/configuracion",
    label: "Configuración",
    icon: Settings,
    module: null,
    permission: null,
    mobile: false,
  },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Items the person may see; the screens check the same permission again. */
export function visibleNavItems(
  can: (permission: string) => boolean,
): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.permission === null || can(item.permission),
  );
}
