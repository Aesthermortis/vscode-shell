import * as fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

// Stolen from vscode-go: https://github.com/microsoft/vscode-go/blob/d6a0fac4d1722367c9496fb516d2d05ec887fbd3/src/goPath.ts#L193
// Workaround for issue in https://github.com/Microsoft/vscode/issues/9448#issuecomment-244804026
/**
 * Normalises driver letter casing on Windows to avoid duplicate paths.
 * @param pathToFix Input path that may have a lowercase drive letter.
 * @returns Path with uppercase drive letter on Windows; unchanged elsewhere.
 */
export function fixDriveCasingInWindows(pathToFix: string): string {
  if (process.platform !== "win32" || pathToFix.length === 0) {
    return pathToFix;
  }

  return pathToFix.slice(0, 1).toUpperCase() + pathToFix.slice(1);
}

/**
 * Determines whether a URI uses the `file` scheme.
 * @param uri URI to inspect.
 * @returns True when the URI uses the file scheme.
 */
function isFileUriScheme(uri: vscode.Uri): boolean {
  return uri.scheme === "file";
}

/**
 * Determines the parent directory of a text document, accounting for untitled documents.
 * @param textDocument Document to inspect.
 * @returns Directory path or undefined when it cannot be determined.
 */
export function guessDocumentDirname(textDocument: vscode.TextDocument): string | undefined {
  if (textDocument.isUntitled) {
    return getWorkspaceFolderPath(textDocument.uri);
  }

  if (isFileUriScheme(textDocument.uri)) {
    return path.dirname(textDocument.fileName);
  }

  return undefined;
}

/**
 * Resolves the workspace folder path for the given URI.
 * @param uri Optional URI to evaluate.
 * @param requireFileUri When true (default) non-file schemes are ignored.
 * @returns Matching workspace folder path or undefined.
 */
export function getWorkspaceFolderPath(
  uri?: vscode.Uri,
  requireFileUri: boolean = true,
): string | undefined {
  const isSafeUriSchemeFunc = requireFileUri ? isFileUriScheme : () => true;
  if (uri) {
    const workspace = vscode.workspace.getWorkspaceFolder(uri);
    if (workspace && isSafeUriSchemeFunc(workspace.uri)) {
      return fixDriveCasingInWindows(workspace.uri.fsPath);
    }
  }

  // fall back to the first workspace if available
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) {
    // Only file uris are supported
    const folder = folders.find((folder) => isSafeUriSchemeFunc(folder.uri));
    if (folder) {
      return fixDriveCasingInWindows(folder.uri.fsPath);
    }
  }

  return undefined;
}

// Ensure the cwd exists, or it will throw ENOENT
// https://github.com/vscode-shellcheck/vscode-shellcheck/issues/767
/**
 * Validates that the provided working directory exists and is a directory.
 * @param cwd Current working directory candidate.
 * @returns Normalised cwd when it exists; otherwise undefined.
 */
export async function ensureCurrentWorkingDirectory(
  cwd: string | undefined,
): Promise<string | undefined> {
  if (!cwd) {
    return undefined;
  }

  try {
    const normalizedCwd = path.resolve(cwd);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- normalizedCwd is resolved from user input.
    const fstat = await fs.promises.stat(normalizedCwd);
    if (!fstat.isDirectory()) {
      return undefined;
    }
    return normalizedCwd;
  } catch {
    return undefined;
  }
}

/**
 * Replaces workspace placeholders with the provided or active workspace path.
 * @param input Path string that may contain workspace placeholders.
 * @param workspaceFolder Optional explicit workspace folder path.
 * @returns Path with placeholders substituted.
 */
export function substitutePath(input: string, workspaceFolder?: string): string {
  const folder =
    workspaceFolder ?? getWorkspaceFolderPath(vscode.window.activeTextEditor?.document.uri) ?? "";

  return input.split("${workspaceRoot}").join(folder).split("${workspaceFolder}").join(folder);
}
