import { statSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

const binPathCache = new Map<string, string>();

/**
 * Locates the absolute path to a binary by scanning the system PATH.
 * Results are memoized for subsequent lookups.
 * @param toolName Binary name or absolute path provided by the user.
 * @returns Absolute path to the resolved executable or `null` when not found.
 */
export function getExecutableFileUnderPath(toolName: string): string | null {
  const cached = binPathCache.get(toolName);
  if (cached) {
    return cached;
  }

  const correctedName = correctBinaryName(toolName);
  if (path.isAbsolute(correctedName) && fileExists(correctedName)) {
    binPathCache.set(toolName, correctedName);
    return correctedName;
  }

  const searchPaths = process.env.PATH?.split(path.delimiter) ?? [];
  for (const base of searchPaths) {
    const candidate = path.join(base, correctedName);
    if (fileExists(candidate)) {
      binPathCache.set(toolName, candidate);
      return candidate;
    }
  }

  return null;
}

/**
 * Ensures the provided binary name includes the Windows executable suffix when needed.
 * @param binName Raw binary name.
 * @returns Binary name with the correct platform-specific suffix.
 */
function correctBinaryName(binName: string): string {
  if (process.platform === "win32" && path.extname(binName) !== ".exe") {
    return `${binName}.exe`;
  }
  return binName;
}

/**
 * Checks whether the file exists and is a regular file.
 * @param filePath Path to validate.
 * @returns True when the path exists and is a file.
 */
export function fileExists(filePath: string): boolean {
  try {
    const normalized = path.normalize(filePath);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `normalized` is derived from caller input.
    return statSync(normalized).isFile();
  } catch {
    return false;
  }
}

/**
 * Replaces workspace placeholders with their actual filesystem paths.
 * @param filePath Path string that may contain VS Code workspace placeholders.
 * @returns Path with `${workspaceRoot}` and `${workspaceFolder}` resolved.
 */
export function substitutePath(filePath: string): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  return filePath
    .split("${workspaceRoot}")
    .join(workspaceFolder)
    .split("${workspaceFolder}")
    .join(workspaceFolder);
}
