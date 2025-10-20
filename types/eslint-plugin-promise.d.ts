declare module "eslint-plugin-promise" {
  import type { Linter } from "eslint";
  const plugin: {
    configs?: Record<string, Linter.Config>;
    rules?: Record<string, unknown>;
  };
  export = plugin;
}
