// Verifies the architectural lint rules (BAS-02) against temporary fixtures.
// Usage: npm run lint:boundaries
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";

const root = process.cwd();
const dirs = {
  a: "src/modules/__fixture_a",
  b: "src/modules/__fixture_b",
  p: "src/platform/__fixture_p",
};

const files = {
  [`${dirs.a}/index.ts`]: 'export { internalValue } from "./internal";\n',
  [`${dirs.a}/internal.ts`]: "export const internalValue = 1;\n",
  [`${dirs.b}/index.ts`]: "export {};\n",
  [`${dirs.p}/index.ts`]: "export {};\n",
};

const cases = [
  {
    name: "a module imports another module's public API",
    file: `${dirs.b}/public-import.ts`,
    code: 'import { internalValue } from "@/modules/__fixture_a";\nexport const x = internalValue;\n',
    expectError: false,
  },
  {
    name: "a module imports another module's internal file (alias)",
    file: `${dirs.b}/deep-alias.ts`,
    code: 'import { internalValue } from "@/modules/__fixture_a/internal";\nexport const x = internalValue;\n',
    expectError: true,
  },
  {
    name: "a module imports another module's internal file (relative)",
    file: `${dirs.b}/deep-relative.ts`,
    code: 'import { internalValue } from "../__fixture_a/internal";\nexport const x = internalValue;\n',
    expectError: true,
  },
  {
    name: "platform depends on a business module",
    file: `${dirs.p}/to-module.ts`,
    code: 'import { internalValue } from "@/modules/__fixture_a";\nexport const x = internalValue;\n',
    expectError: true,
  },
  {
    name: "platform reaches a module through a type query",
    file: `${dirs.p}/type-query.ts`,
    code: 'export type X = typeof import("@/modules/__fixture_a");\n',
    expectError: true,
  },
  {
    name: "a module reaches another module's internal file through a type query",
    file: `${dirs.b}/type-query-deep.ts`,
    code: 'export type X = typeof import("@/modules/__fixture_a/internal");\n',
    expectError: true,
  },
  {
    name: "a module dynamically imports another module's internal file",
    file: `${dirs.b}/dynamic-deep.ts`,
    code: 'export const load = () => import("@/modules/__fixture_a/internal");\n',
    expectError: true,
  },
  {
    name: "app imports a module's internal file",
    file: "src/app/__fixture_page.ts",
    code: 'import { internalValue } from "@/modules/__fixture_a/internal";\nexport const x = internalValue;\n',
    expectError: true,
  },
  {
    name: "a module imports its own internal file",
    file: `${dirs.a}/own.ts`,
    code: 'import { internalValue } from "./internal";\nexport const x = internalValue;\n',
    expectError: false,
  },
];

const boundaryRule = (m) => m.ruleId?.startsWith("boundaries/");

let failures = 0;
try {
  for (const [file, code] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), code);
  }
  for (const c of cases) writeFileSync(path.join(root, c.file), c.code);

  const eslint = new ESLint({ cwd: root });
  for (const c of cases) {
    const [result] = await eslint.lintFiles([c.file]);
    const errors = (result?.messages ?? []).filter(boundaryRule);
    const ok = c.expectError ? errors.length > 0 : errors.length === 0;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
    if (!ok)
      for (const e of errors) console.log(`      ${e.ruleId}: ${e.message}`);
  }
} finally {
  for (const dir of Object.values(dirs)) {
    rmSync(path.join(root, dir), { recursive: true, force: true });
  }
  rmSync(path.join(root, "src/app/__fixture_page.ts"), { force: true });
}

if (failures > 0) {
  console.error(`\n${failures} boundary case(s) failed.`);
  process.exit(1);
}
console.log("\nAll boundary cases passed.");
