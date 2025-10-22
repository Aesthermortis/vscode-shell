import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

const source = path.join(repoRoot, "node_modules", "@one-ini", "wasm", "one_ini_bg.wasm");
const targetDir = path.join(repoRoot, "dist");
const target = path.join(targetDir, "one_ini_bg.wasm");

try {
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  console.log(`[copy-assets] Copied ${source} -> ${target}`);
} catch (error) {
  console.error("[copy-assets] Failed to copy one_ini_bg.wasm:", error);
  process.exitCode = 1;
}
