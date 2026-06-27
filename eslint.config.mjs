import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "model-artifacts/**", "prisma/generated/**", "next-env.d.ts"]
  },
  // Architecture boundary: src/domain must stay pure (framework-free, no IO, no upward deps).
  // See AGENTS.md §2 and §8.
  {
    files: ["src/domain/**/*.ts", "src/domain/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib",
                "@/lib/*",
                "@/server",
                "@/server/*",
                "@/app",
                "@/app/*",
                "@/components",
                "@/components/*"
              ],
              message:
                "src/domain must stay pure: no imports from lib/server/app/components (AGENTS.md §2)."
            }
          ],
          paths: [
            { name: "@prisma/client", message: "src/domain must not touch the database or Prisma (AGENTS.md §2)." }
          ]
        }
      ]
    }
  },
  // Architecture boundary: database access is confined to the Prisma adapter + composition root.
  // Applies to all src files except the domain layer (already covered above) and the adapter files.
  // See AGENTS.md §4 and §8.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: [
      "src/domain/**",
      "src/server/prisma.ts",
      "src/server/services/prisma-store.ts",
      "src/server/services/index.ts"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              message:
                "Use WorldModelStore instead of @prisma/client directly; DB access is confined to src/server/services/prisma-store.ts (AGENTS.md §4)."
            },
            {
              name: "@/server/prisma",
              message: "Import the prisma client only from the store/composition layer (AGENTS.md §4)."
            }
          ]
        }
      ]
    }
  }
];

export default eslintConfig;
