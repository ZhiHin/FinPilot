import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    "src/server/db/migrations/**",
  ]),
  {
    // Money safety: floating-point-shaped APIs are banned everywhere money could flow.
    // Formatting/parsing lives exclusively in src/lib/money (exempted below).
    name: "finpilot/no-float-money",
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: "Never parse money (or anything) with parseFloat — use lib/money (ADR-003).",
        },
        {
          selector:
            "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
          message: "Never parse money with Number.parseFloat — use lib/money (ADR-003).",
        },
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: "Never format numbers with toFixed — use lib/money formatters (ADR-003).",
        },
      ],
    },
  },
  {
    name: "finpilot/money-lib-exemption",
    files: ["src/lib/money/**"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // Module boundaries (architecture doc §2): design-system components stay domain-free.
    name: "finpilot/boundaries-components",
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*", "@/server/*"],
              message:
                "Design-system components must not depend on features or server code (architecture doc §2).",
            },
          ],
        },
      ],
    },
  },
  {
    // Domain services are framework-free.
    name: "finpilot/boundaries-services",
    files: ["src/server/services/**/*.ts", "src/server/db/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "next", "next/*"],
              message:
                "Server services and the db layer are framework-independent (architecture doc §2).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
