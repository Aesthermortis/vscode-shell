import * as vscode from "vscode";
import { FORMAT_OUTPUT_CHANNEL, FORMAT_SECTION } from "../constants.js";
import { checkInstall } from "./downloader.js";
import {
  ConfigItemName,
  configurationPrefix,
  Formatter,
  ShellDocumentFormattingEditProvider,
} from "./shFormat.js";

export enum DocumentFilterScheme {
  File = "file",
  Untitled = "untitled",
}

const formatOnSaveConfig = "editor.formatOnSave";
const formatDocumentCommand = "editor.action.formatDocument";

export const shellformatPath = `${FORMAT_SECTION}.path`;

const allowedDocumentSchemes = new Set<string>([
  DocumentFilterScheme.File,
  DocumentFilterScheme.Untitled,
]);

export const output = vscode.window.createOutputChannel(FORMAT_OUTPUT_CHANNEL);
/**
 * Registers and activates the shell formatter feature set for the extension lifecycle.
 * @param context VS Code extension context providing subscription management.
 */
export function activateFormatFeature(context: vscode.ExtensionContext): void {
  const settings = vscode.workspace.getConfiguration(configurationPrefix);
  const shfmter = new Formatter(context, output);
  const shFmtProvider = new ShellDocumentFormattingEditProvider(shfmter, settings);
  void (async () => {
    try {
      await checkInstall(context, output);
    } catch (error) {
      output.appendLine(`Failed to verify shfmt installation: ${String(error)}`);
    }
  })();

  const effectLanguages = settings.get<string[]>(ConfigItemName.EffectLanguages) ?? [];
  for (const languageId of effectLanguages) {
    for (const scheme of Object.values(DocumentFilterScheme)) {
      context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
          { language: languageId, scheme /* pattern: "*.sh" */ },
          shFmtProvider,
        ),
      );
    }
  }

  const formatOnSave = vscode.workspace.getConfiguration().get<boolean>(formatOnSaveConfig);
  if (formatOnSave) {
    const disposable = vscode.workspace.onWillSaveTextDocument((event) => {
      const isManualSave = event.reason === vscode.TextDocumentSaveReason.Manual;
      if (isManualSave && isAllowedTextDocument(event.document)) {
        return vscode.commands
          .executeCommand(formatDocumentCommand)
          .then(undefined, (error: unknown) => {
            output.appendLine(`Format command failed: ${String(error)}`);
          });
      }
    });
    context.subscriptions.push(disposable);
  }
}

/**
 * Determines whether the given text document should trigger formatting.
 * @param textDocument Text document pending save.
 * @returns True when formatting should be applied.
 */
function isAllowedTextDocument(textDocument: vscode.TextDocument): boolean {
  const settings = vscode.workspace.getConfiguration(configurationPrefix);
  const effectLanguages = settings.get<string[]>(ConfigItemName.EffectLanguages) ?? [];
  if (!effectLanguages.includes(textDocument.languageId)) {
    return false;
  }

  return allowedDocumentSchemes.has(textDocument.uri.scheme);
}

/**
 * Placeholder for future deactivation cleanup.
 */
export function deactivateFormatFeature(): void {
  // No-op: formatting registrations are disposed through context subscriptions.
}
