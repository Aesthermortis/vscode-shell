// @ts-check

import { createRequire } from "node:module";
import css from "@eslint/css";
import { FlatCompat } from "@eslint/eslintrc";
import eslint from "@eslint/js";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import html from "@html-eslint/eslint-plugin";
import * as htmlParser from "@html-eslint/parser";
import stylistic from "@stylistic/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";
import { importX } from "eslint-plugin-import-x";
import pluginJest from "eslint-plugin-jest";
import jsdocPlugin from "eslint-plugin-jsdoc";
import jsxA11y from "eslint-plugin-jsx-a11y";
import nodePlugin from "eslint-plugin-n";
import nounsanitized from "eslint-plugin-no-unsanitized";
import * as regexpPlugin from "eslint-plugin-regexp";
import * as sonarjs from "eslint-plugin-sonarjs";
import unicornPlugin from "eslint-plugin-unicorn";
import yml from "eslint-plugin-yml";
import { defineConfig } from "eslint/config";
import globals from "globals";
import * as tseslint from "typescript-eslint";
import * as yamlParser from "yaml-eslint-parser";

const require = createRequire(import.meta.url);
const security = require("eslint-plugin-security");

// Define a FlatCompat instance to convert old configs
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

/** @type {(cfg: unknown) => import("eslint").Linter.Config} */
const asFlat = (cfg) => /** @type {import("eslint").Linter.Config} */ (cfg);

/**
 * @typedef {{ configs: { recommended: import("eslint").Linter.Config } }} PluginWithRecommendedConfig
 */

const nounsanitizedPlugin = /** @type {PluginWithRecommendedConfig} */ (
  /** @type {unknown} */ (nounsanitized)
);

// Define glob patterns for test files
const testGlobs = ["**/*.{test,spec}.{js,jsx,cjs,mjs,ts,tsx,cts,mts}", "**/jest.setup.js"];

// Base global variables for all environments
const baseGlobals = {
  ...globals.browser,
  ...globals.es2025,
  ...globals.node,
  ...globals.greasemonkey,
};

export default defineConfig([
  {
    name: "Global Ignores",
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      ".next/**",
      "coverage/**",
      ".github/**",
      ".vscode/**",
      "package-lock.json",
    ],
  },

  eslint.configs.recommended,
  tseslint.configs.recommended,
  jsdocPlugin.configs["flat/recommended-mixed"],
  jsxA11y.flatConfigs.recommended,
  security.configs.recommended,
  asFlat(importX.flatConfigs.recommended),
  asFlat(importX.flatConfigs.typescript),
  asFlat(nounsanitizedPlugin.configs.recommended),
  ...compat.extends("plugin:promise/recommended"),
  ...compat.extends("plugin:@eslint-community/eslint-comments/recommended"),

  // JavaScript
  {
    name: "JavaScript",
    files: ["**/*.{js,jsx,cjs,mjs}"],
    ignores: testGlobs,
    plugins: { html },
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: { ...baseGlobals },
    },
  },

  // CommonJS
  {
    name: "CommonJS",
    files: ["**/*.cjs"],
    extends: [nodePlugin.configs["flat/recommended-script"]],
  },

  // TypeScript
  {
    name: "TypeScript",
    files: ["**/*.{ts,tsx,cts,mts}"],
    ignores: testGlobs,
    plugins: { html },
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Node
  {
    name: "Node",
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    ignores: testGlobs,
    extends: [nodePlugin.configs["flat/recommended-module"]],
    rules: {
      "n/no-missing-import": [
        "error",
        {
          allowModules: ["vscode"],
          resolvePaths: ["node_modules/@types"],
          tryExtensions: [".ts", ".d.ts", ".js", ".json", ".node"],
        },
      ],
      "n/no-extraneous-import": ["error", { allowModules: ["vscode"] }],
    },
  },

  // RegExp
  {
    name: "RegExp",
    files: ["**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}"],
    extends: [regexpPlugin.configs["flat/recommended"]],
  },

  // Sonarjs
  {
    name: "Sonarjs",
    files: ["**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}"],
    extends: [sonarjs.configs["recommended"]],
  },

  // Unicorn
  {
    name: "Unicorn",
    files: ["**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}"],
    extends: [unicornPlugin.configs["recommended"]],
  },

  // Jest
  {
    name: "Tests",
    files: testGlobs,
    extends: [
      pluginJest.configs["flat/recommended"],
      pluginJest.configs["flat/style"],
      ...compat.extends("plugin:jest-extended/all"),
    ],
    languageOptions: {
      globals: { ...baseGlobals },
    },
    rules: {
      // Tests run in jsdom and may reference browser globals (EventSource, WebSocket, etc.).
      // Disable the node builtins check here to avoid false positives about experimental
      // Node builtin status (the configured engines range is used by the rule).
      "n/no-unsupported-features/node-builtins": "off",
    },
  },

  // JSON
  {
    name: "JSON",
    files: ["**/*.json"],
    ignores: ["package-lock.json"],
    plugins: { json },
    extends: ["json/recommended"],
    language: "json/json",
    rules: {
      "no-irregular-whitespace": "off",
    },
  },

  // JSONC
  {
    name: "JSONC",
    files: ["**/*.jsonc"],
    plugins: { json },
    extends: ["json/recommended"],
    language: "json/jsonc",
    rules: {
      "no-irregular-whitespace": "off",
    },
  },

  // JSON5
  {
    name: "JSON5",
    files: ["**/*.json5"],
    plugins: { json },
    extends: ["json/recommended"],
    language: "json/json5",
  },

  // Markdown
  {
    name: "Markdown",
    files: ["**/*.md"],
    plugins: { markdown },
    extends: ["markdown/recommended"],
    language: "markdown/gfm",
    languageOptions: {
      frontmatter: "yaml",
    },
    rules: {
      "no-irregular-whitespace": "off",
    },
  },

  // YAML
  {
    name: "YAML",
    files: ["**/*.{yml,yaml}"],
    extends: [yml.configs["flat/recommended"]],
    languageOptions: {
      parser: yamlParser,
      parserOptions: {
        defaultYAMLVersion: "1.2",
      },
    },
  },

  // CSS
  {
    name: "CSS",
    files: ["**/*.css"],
    plugins: { css },
    extends: ["css/recommended"],
    language: "css/css",
    rules: {
      "no-irregular-whitespace": "off",
    },
  },

  // HTML
  {
    name: "HTML",
    files: ["**/*.html"],
    plugins: { html },
    extends: ["html/recommended"],
    language: "html/html",
    languageOptions: {
      parser: htmlParser,
      // This tells the parser to treat {{ ... }} as template syntax,
      // so it won’t try to parse contents inside as regular HTML
      templateEngineSyntax: {
        "{{": "}}",
      },
    },
    rules: {
      "no-irregular-whitespace": "off",
    },
  },

  // Stylistic
  {
    name: "Stylistic",
    files: ["**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}"],
    extends: [stylistic.configs.recommended],
  },

  // Prettier
  {
    name: "Prettier",
    ...eslintConfigPrettier,
  },

  // Custom rules
  {
    name: "Custom",
    files: ["**/*"],
    rules: {
      "n/no-unpublished-import": "off",
      "n/no-unsupported-features/node-builtins": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-null": "off",
      "unicorn/filename-case": "off",
    },
  },
]);
