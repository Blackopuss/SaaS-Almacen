"use client";

import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "./theme-script";

/**
 * Light/dark theme without extra dependencies. The `dark` class on <html>
 * is the single source of truth: an inline script (./theme-script) sets it
 * before the first paint, and this hook reads/changes it afterwards.
 */
export type Theme = "light" | "dark";

const CHANGE_EVENT = "almacen-tema-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const read = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

export function setTheme(theme: Theme): void {
  // Avoid every element animating its colors during the switch.
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(style);
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode: the theme still applies for this page.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
}

/** Current theme; `undefined` while rendering on the server. */
export function useTheme(): {
  theme: Theme | undefined;
  setTheme: typeof setTheme;
} {
  const theme = useSyncExternalStore<Theme | undefined>(
    subscribe,
    read,
    () => undefined,
  );
  return { theme, setTheme };
}
