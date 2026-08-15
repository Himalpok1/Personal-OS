// @ts-check
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/coverage/**",
      "apps/mobile/**",
      "packages/db/drizzle/**",
      // Standalone config files outside any package's tsconfig "include" —
      // not worth a dedicated tsconfig project just for type-aware linting.
      "eslint.config.js",
      "**/vitest.config.ts",
      "packages/db/drizzle.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The failure mode this repo worries about most: a worker job or
      // async route handler silently not awaited (see docs/ARCHITECTURE.md,
      // "Worker crashes must be loud").
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  eslintConfigPrettier,
);
