import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  sourcemap: true,
  clean: true,
  bundle: true,
  splitting: false,
  skipNodeModulesBundle: false,
  outDir: "dist",
  treeshake: false,
  external: ["vscode"],
  noExternal: ["diff", "editorconfig", "execa", "lodash", "minimatch", "semver"],
  tsconfig: "tsconfig.build.json",
  banner: {
    js: [
      'import { createRequire as __createRequire } from "node:module";',
      'import { fileURLToPath as __fileURLToPath } from "node:url";',
      'import { dirname as __dirnameFn } from "node:path";',
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __dirnameFn(__filename);",
      "",
    ].join("\n"),
  },
});
