declare module "@eslint-community/eslint-plugin-eslint-comments/configs" {
  import type { Linter } from "eslint";
  const configs: Record<string, Linter.Config>;
  export default configs;
}
