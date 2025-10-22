import * as vscode from "vscode";
import { activateFormatFeature, deactivateFormatFeature } from "./format/extension.js";
import type { ShellCheckExtensionApi } from "./shellcheck/api.js";
import { activateShellCheckFeature, deactivateShellCheckFeature } from "./shellcheck/extension.js";

let cachedShellCheckApi: ShellCheckExtensionApi | undefined;

/**
 * Entry point invoked by VS Code when the extension activates.
 * @param context Extension context provided by VS Code.
 * @returns ShellCheck feature API exposed to other extensions.
 */
export function activate(context: vscode.ExtensionContext): ShellCheckExtensionApi {
  activateFormatFeature(context);
  cachedShellCheckApi = activateShellCheckFeature(context);
  return cachedShellCheckApi;
}

/**
 * Called by VS Code when the extension is deactivated.
 */
export function deactivate(): void {
  deactivateFormatFeature();
  deactivateShellCheckFeature();
  cachedShellCheckApi = undefined;
}
