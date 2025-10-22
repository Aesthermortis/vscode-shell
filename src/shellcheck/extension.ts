import * as vscode from "vscode";
import {
  SHELLCHECK_LINK_LANGUAGE,
  SHELLCHECK_OUTPUT_CHANNEL,
  SHELLCHECK_SECTION,
} from "../constants.js";
import type { ShellCheckExtensionApi } from "./api.js";
import { LinkifyProvider } from "./linkify.js";
import ShellCheckProvider from "./linter.js";
import { registerLogger, setLoggingLevel } from "./utils/logging/index.js";
import { OutputChannelLogger } from "./utils/logging/logger-outputchannel.js";
import type { LogLevelNameType } from "./utils/logging/types.js";

type RelatedFilesProvider = {
  provideRelatedFiles?(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<readonly vscode.Uri[]>;
};

type RelatedFilesApi = {
  registerRelatedFileProvider(
    selectors: readonly { language: string }[],
    provider: RelatedFilesProvider,
  ): vscode.Disposable;
};

/**
 * Activates the ShellCheck feature set and registers extension resources.
 * @param context Extension context to register disposables.
 * @returns Public ShellCheck extension API surface.
 */
export function activateShellCheckFeature(
  context: vscode.ExtensionContext,
): ShellCheckExtensionApi {
  // Setup logging
  const outputChannel = vscode.window.createOutputChannel(
    SHELLCHECK_OUTPUT_CHANNEL,
    SHELLCHECK_LINK_LANGUAGE,
  );
  const logger = new OutputChannelLogger(outputChannel);
  const loggingDisposable = registerLogger(logger);

  const configurationDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${SHELLCHECK_SECTION}.logLevel`)) {
      updateLoggingLevel();
    }
  });

  context.subscriptions.push(outputChannel, loggingDisposable, configurationDisposable);
  updateLoggingLevel();

  const linter = new ShellCheckProvider(context);
  context.subscriptions.push(linter);

  const relatedFilesApi = (vscode as typeof vscode & { relatedFiles?: RelatedFilesApi })
    .relatedFiles;
  if (relatedFilesApi) {
    const relatedFilesDisposable = relatedFilesApi.registerRelatedFileProvider(
      ShellCheckProvider.LANGUAGES.map((language) => ({ language })),
      {
        provideRelatedFiles() {
          return [];
        },
      },
    );
    context.subscriptions.push(relatedFilesDisposable);
  }

  // link provider
  const linkDisposables = ShellCheckProvider.LANGUAGES.map((language) =>
    vscode.languages.registerDocumentLinkProvider(language, new LinkifyProvider()),
  );
  context.subscriptions.push(...linkDisposables);

  // public API surface
  return linter.provideApi();
}

/**
 * Placeholder deactivation hook; subscriptions are disposed via the extension context.
 */
export function deactivateShellCheckFeature(): void {}

/**
 * Reads the configured log level and applies it to the logging subsystem.
 */
function updateLoggingLevel(): void {
  const settings = vscode.workspace.getConfiguration(SHELLCHECK_SECTION);
  setLoggingLevel(settings.get<LogLevelNameType>("logLevel"));
}
