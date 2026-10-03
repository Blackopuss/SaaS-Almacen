// Shared visual components. shadcn/ui primitives live in ./ui.
export { AppShell } from "./app-shell/app-shell";
export { NAV_ITEMS, isActive } from "./app-shell/nav";
export type { NavItem } from "./app-shell/nav";
export {
  AnimatePresence,
  FadeIn,
  MotionProvider,
  motion,
  transitions,
} from "./motion";
export { Providers } from "./providers";
export {
  EmptyState,
  ErrorState,
  LoadingState,
  PageContainer,
  PageHeader,
} from "./states";
