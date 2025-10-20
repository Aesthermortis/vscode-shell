// @ts-check
import { defineConfig } from "stylelint-define-config";

/** @type {import("stylelint").Config} */
export default defineConfig({
  extends: ["stylelint-config-standard", "stylelint-config-clean-order"],
  rules: {
    "selector-class-pattern": [
      "^([a-z][a-z0-9]*)(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$",
      { message: "Selector should be in BEM format (e.g., block__element--modifier)" },
    ],
  },
});
