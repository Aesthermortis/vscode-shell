// @ts-check

import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import css from "@eslint/css";
import js from "@eslint/js";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import html from "@html-eslint/eslint-plugin";
import * as htmlParser from "@html-eslint/parser";
import stylistic from "@stylistic/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";
import { importX } from "eslint-plugin-import-x";
import pluginJest from "eslint-plugin-jest";
import jestExtended from "eslint-plugin-jest-extended";
import jsdocPlugin from "eslint-plugin-jsdoc";
import jsxA11y from "eslint-plugin-jsx-a11y";
import nodePlugin from "eslint-plugin-n";
import nounsanitized from "eslint-plugin-no-unsanitized";
import promise from "eslint-plugin-promise";
import * as regexpPlugin from "eslint-plugin-regexp";
import security from "eslint-plugin-security";
import * as sonarjs from "eslint-plugin-sonarjs";
import unicornPlugin from "eslint-plugin-unicorn";
import yml from "eslint-plugin-yml";
import { defineConfig } from "eslint/config";
import globals from "globals";
import * as tseslint from "typescript-eslint";
import * as yamlParser from "yaml-eslint-parser";

// Define glob patterns for test files
const testGlobs = ["**/*.{test,spec}.{js,jsx,cjs,mjs,ts,tsx,cts,mts}", "**/jest.setup.js"];

// Base global variables for all environments
const baseGlobals = {
  ...globals.browser,
  ...globals.es2025,
  ...globals.node,
  ...globals.greasemonkey,
};

/**
 * Type guard: narrows a plugin to an object with an optional `configs` map.
 * @param {unknown} plugin - ESLint plugin module.
 * @returns {plugin is { configs?: Record<string, import("eslint").Linter.Config> }} True when the plugin exposes a `configs` property.
 */
const hasConfigs = (plugin) => {
  return plugin != null && typeof plugin === "object" && "configs" in plugin;
};

/**
 * Returns a plugin preset when available, keeping `@ts-check` type safety intact.
 * @param {unknown} plugin ESLint plugin that may expose preset flat configs.
 * @param {string} key Preset identifier to read from the plugin configuration map.
 * @returns {import("eslint").Linter.Config | undefined} Matching flat config when the preset exists.
 */
const preset = (plugin, key) => {
  if (!hasConfigs(plugin)) {
    return;
  }
  const cfgs = plugin.configs;
  if (!cfgs || !Object.prototype.hasOwnProperty.call(cfgs, key)) {
    return;
  }
  const map = new Map(Object.entries(cfgs));
  return map.get(key);
};

const flatConfig = /** @type {import("eslint").Linter.Config[]} */ ([
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

  jsdocPlugin.configs["flat/recommended-mixed"],
  comments.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  preset(promise, "flat/recommended"),
  preset(security, "recommended"),
  jsxA11y.flatConfigs.recommended,
  preset(nounsanitized, "recommended"),

  // Node
  {
    name: "Node",
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    ignores: testGlobs,
    extends: [nodePlugin.configs["flat/recommended-module"]],
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

  // JavaScript
  {
    name: "JavaScript",
    files: ["**/*.{js,jsx,cjs,mjs}"],
    ignores: testGlobs,
    plugins: { html },
    extends: [js.configs.recommended],
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
    extends: [tseslint.configs.recommended],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },

  // Jest
  {
    name: "Tests",
    files: testGlobs,
    extends: [
      pluginJest.configs["flat/recommended"],
      pluginJest.configs["flat/style"],
      preset(jestExtended, "flat/all"),
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

export default defineConfig(flatConfig);
