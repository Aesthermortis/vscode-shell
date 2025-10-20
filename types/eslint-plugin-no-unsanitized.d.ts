declare module "eslint-plugin-no-unsanitized" {
  import type { Linter } from "eslint";
  const plugin: {
    configs?: Record<string, Linter.Config>;
  };
  export = plugin;
}
