import {
  ArrowLeftRight,
  ClipboardCheck,
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
  /** Shown in the mobile bottom bar (max 4 + «Más»). */
  mobile: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/inventario",
    label: "Inventario",
    icon: Package,
    module: "inventory",
    mobile: true,
  },
  {
    href: "/movimientos",
    label: "Movimientos",
    icon: ArrowLeftRight,
    module: "inventory",
    mobile: true,
  },
  {
    href: "/ubicaciones",
    label: "Ubicaciones",
    icon: MapPin,
    module: "inventory",
    mobile: true,
  },
  {
    href: "/conteos",
    label: "Conteos",
    icon: ClipboardCheck,
    module: "inventory",
    mobile: true,
  },
  {
    href: "/compras",
    label: "Compras",
    icon: ShoppingCart,
    module: "purchasing",
    mobile: false,
  },
  {
    href: "/configuracion",
    label: "Configuración",
    icon: Settings,
    module: null,
    mobile: false,
  },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
