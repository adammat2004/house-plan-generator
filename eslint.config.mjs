import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The domain must stay headless: no UI frameworks, rendering, browser or editor state.
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom", "react/*", "next", "next/*"], message: "Domain code must not depend on React or Next.js." },
            { group: ["konva", "konva/*", "react-konva"], message: "Domain code must not depend on Konva." },
            { group: ["zustand", "zustand/*"], message: "Domain code must not depend on editor state." },
            { group: ["@/editor/*", "@/persistence/*", "@/components/*", "@/app/*"], message: "Domain code must not import outer layers." },
          ],
        },
      ],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "indexedDB", "navigator"],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**", ".claude/worktrees/**"]),
]);

export default eslintConfig;
