import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import boundaries from "eslint-plugin-boundaries";

// Architectural boundaries (BAS-02). See "Arquitectura" in AGENTS.md.
// Other modules, platform areas and lib are reachable only through index.ts.
const publicApi = (...types) => ({
  types: { anyOf: types },
  fileInternalPath: "index.ts",
});
const anyFile = (...types) => ({ types: { anyOf: types } });

const architecture = {
  files: ["src/**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "import/resolver": {
      typescript: { alwaysTryTypes: true, project: "./tsconfig.json" },
    },
    // Also check `typeof import("...")` type queries, not detected by default.
    "boundaries/additional-dependency-nodes": [
      {
        selector: "TSImportType > Literal",
        kind: "type",
        name: "ts-import-type",
      },
    ],
    "boundaries/elements": [
      { type: "app", pattern: "src/app" },
      { type: "components", pattern: "src/components" },
      { type: "lib", pattern: "src/lib" },
      { type: "server", pattern: "src/server" },
      { type: "platform", pattern: "src/platform/*" },
      { type: "module", pattern: "src/modules/*" },
    ],
  },
  rules: {
    "boundaries/dependencies": [
      "error",
      {
        default: "disallow",
        message:
          "Dependencia no permitida: respeta las capas y usa solo el index.ts de otros módulos (ver Arquitectura en AGENTS.md).",
        policies: [
          {
            from: { element: { type: "app" } },
            allow: {
              to: {
                element: [
                  publicApi("module", "platform", "lib"),
                  anyFile("components"),
                ],
              },
            },
          },
          {
            from: { element: { type: "module" } },
            allow: {
              to: {
                element: [
                  publicApi("module", "platform", "lib"),
                  anyFile("server", "components"),
                ],
              },
            },
          },
          {
            from: { element: { type: "platform" } },
            allow: {
              to: {
                element: [publicApi("platform", "lib"), anyFile("server")],
              },
            },
          },
          {
            from: { element: { types: { anyOf: ["server", "components"] } } },
            allow: { to: { element: publicApi("lib") } },
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  architecture,
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".agents/**",
    ".claude/**",
    "src/server/generated/**",
  ]),
]);

export default eslintConfig;
