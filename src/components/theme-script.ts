// Shared by the root layout (Server Component) and the theme hook. Kept out
// of the "use client" module so the server receives real values.
export const THEME_STORAGE_KEY = "almacen-tema";

/** Runs before hydration (root layout): applies the saved theme, no flash. */
export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;
