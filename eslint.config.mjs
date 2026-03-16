import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "fhevmTemp/**",
      "tmp/**",
      ".coverage_artifacts/**",
      ".coverage_cache/**",
      ".coverage_contracts/**",
      "artifacts/**",
      "build/**",
      "cache/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "types/**",
      "frontend/**",
      "*.env",
      "*.log",
      "coverage.json",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": [
        "error",
        { ignoreIIFE: true, ignoreVoid: true },
      ],
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "_", varsIgnorePattern: "_" },
      ],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "no-empty": "warn",
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "warn",
      "no-empty": "warn",
    },
  }
);
