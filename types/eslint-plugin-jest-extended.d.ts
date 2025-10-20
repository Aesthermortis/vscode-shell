declare module "eslint-plugin-jest-extended" {
  import type { Linter } from "eslint";
  const plugin: {
    configs?: Record<string, Linter.Config>;
  };
  export = plugin;
}
