import path from "node:path";
import { execa } from "execa";
import * as semver from "semver";
import * as vscode from "vscode";
import { SHELLCHECK_COMMAND_PREFIX, SHELLCHECK_SECTION } from "../constants.js";
import type { ShellCheckExtensionApi } from "./api.js";
import { FixAllProvider } from "./fix-all.js";
import { createParser } from "./parser.js";
import type { ParseResult } from "./parser.js";
import { checkIfConfigurationChanged, getWorkspaceSettings, RunTrigger } from "./settings.js";
import type { ShellCheckSettings } from "./settings.js";
import { ThrottledDelayer } from "./utils/async.js";
import { getWikiUrlForRule } from "./utils/link.js";
import * as logging from "./utils/logging/index.js";
import {
  ensureCurrentWorkingDirectory,
  getWorkspaceFolderPath,
  guessDocumentDirname,
} from "./utils/path.js";
import { getToolVersion, tryPromptForUpdatingTool } from "./utils/tool-check.js";

const CommandIds = {
  runLint: `${SHELLCHECK_COMMAND_PREFIX}.runLint`,
  disableCheckForLine: `${SHELLCHECK_COMMAND_PREFIX}.disableCheckForLine`,
  openRuleDoc: `${SHELLCHECK_COMMAND_PREFIX}.openRuleDoc`,
  collectDiagnostics: `${SHELLCHECK_COMMAND_PREFIX}.collectDiagnostics`,
} as const;

type ToolStatus =
  | { ok: true; version: semver.SemVer }
  | { ok: false; reason: "executableNotFound" | "executionFailed" };

/**
 * Checks whether the thrown error indicates a missing shellcheck executable.
 * @param error Value thrown during process execution.
 * @returns True when the error indicates the executable is missing.
 */
function errorLooksLikeMissingExecutable(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const err = error as Partial<NodeJS.ErrnoException> & {
    stderr?: string;
    stdout?: string;
    shortMessage?: string;
    originalMessage?: string;
    exitCode?: number;
  };

  const code = typeof err.code === "string" ? err.code : undefined;
  const errno = typeof err.errno === "string" ? err.errno : undefined;
  const missingCodes = new Set(["ENOENT"]);

  if ((code && missingCodes.has(code)) || (errno && missingCodes.has(errno))) {
    return true;
  }

  const numericExitCode = typeof err.code === "number" ? err.code : err.exitCode;
  if (numericExitCode === 127 || numericExitCode === 9009) {
    return true;
  }

  const haystacks = [
    err.stderr,
    err.stdout,
    err.shortMessage,
    err.originalMessage,
    (err as Error).message,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());

  return haystacks.some((text) => {
    return (
      text.includes("command not found") ||
      text.includes("no such file or directory") ||
      text.includes("is not recognized as an internal or external command") ||
      text.includes("is not recognised as an internal or external command")
    );
  });
}

/**
 * Maps a thrown error to a tool status structure.
 * @param error Value thrown during tool execution.
 * @returns Tool status describing the failure.
 */
function toolStatusByError(error: unknown): ToolStatus {
  if (error instanceof Error && errorLooksLikeMissingExecutable(error)) {
    return { ok: false, reason: "executableNotFound" };
  }

  return { ok: false, reason: "executionFailed" };
}

/**
 * Extracts a ShellCheck rule identifier from a diagnostic, when available.
 * @param diagnostic Diagnostic emitted by ShellCheck.
 * @returns Rule identifier (e.g. SC2086) or undefined when not applicable.
 */
function extractRuleId(diagnostic: vscode.Diagnostic): string | undefined {
  if (
    typeof diagnostic.code === "object" &&
    typeof diagnostic.code?.value === "string" &&
    diagnostic.code.value.startsWith("SC")
  ) {
    return diagnostic.code.value;
  }
  return undefined;
}

export default class ShellCheckProvider implements vscode.CodeActionProvider {
  public static readonly LANGUAGES = ["shellscript", "bats"];

  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Source,
  ];

  public static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: ShellCheckProvider.providedCodeActionKinds,
  };

  private readonly delayers: Map<string, ThrottledDelayer<void>>;
  private readonly settingsByUri: Map<string, ShellCheckSettings>;
  private readonly toolStatusByPath: Map<string, ToolStatus>;
  private readonly diagnosticCollection: vscode.DiagnosticCollection;
  private readonly codeActionCollection: Map<string, ParseResult[]>;
  private readonly additionalDocumentFilters: Set<vscode.DocumentFilter>;
  private readonly notifiedMissingExecutable: Set<string>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.delayers = new Map();
    this.settingsByUri = new Map();
    this.toolStatusByPath = new Map();
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection(SHELLCHECK_SECTION);
    this.codeActionCollection = new Map();
    this.additionalDocumentFilters = new Set();
    this.notifiedMissingExecutable = new Set();

    // code actions
    for (const language of ShellCheckProvider.LANGUAGES) {
      const disposables = [
        vscode.languages.registerCodeActionsProvider(language, this, ShellCheckProvider.metadata),
        vscode.languages.registerCodeActionsProvider(
          language,
          new FixAllProvider(),
          FixAllProvider.metadata,
        ),
      ];
      context.subscriptions.push(...disposables);
    }

    // commands
    context.subscriptions.push(
      vscode.commands.registerCommand(CommandIds.openRuleDoc, async (url: string) => {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(url));
      }),
      vscode.commands.registerCommand(
        CommandIds.disableCheckForLine,
        async (document: vscode.TextDocument, ruleId: string, range: vscode.Range) => {
          await this.disableCheckForLine(document, ruleId, range);
        },
      ),
      vscode.commands.registerTextEditorCommand(CommandIds.runLint, (editor) => {
        void this.triggerLint(editor.document);
      }),
      vscode.commands.registerTextEditorCommand(CommandIds.collectDiagnostics, (editor) => {
        void this.collectDiagnostics(editor.document);
      }),
    );

    // event handlers
    vscode.workspace.onDidChangeConfiguration(
      this.handleDidChangeConfiguration,
      this,
      context.subscriptions,
    );
    vscode.workspace.onDidOpenTextDocument(
      this.handleDidOpenTextDocument,
      this,
      context.subscriptions,
    );
    vscode.workspace.onDidCloseTextDocument(
      this.handleDidCloseTextDocument,
      this,
      context.subscriptions,
    );
    vscode.workspace.onDidChangeTextDocument(
      this.handleDidChangeTextDocument,
      this,
      context.subscriptions,
    );
    vscode.workspace.onDidSaveTextDocument(
      this.handleDidSaveTextDocument,
      this,
      context.subscriptions,
    );

    // Shellcheck all open shell documents
    this.scheduleInitialLint();
  }

  private readonly handleDidCloseTextDocument = (textDocument: vscode.TextDocument): void => {
    this.setResultCollections(textDocument.uri);
    this.settingsByUri.delete(textDocument.uri.toString());
    this.delayers.delete(textDocument.uri.toString());
  };

  private readonly handleDidChangeConfiguration = (e: vscode.ConfigurationChangeEvent): void => {
    if (!checkIfConfigurationChanged(e)) {
      return;
    }

    this.settingsByUri.clear();
    this.toolStatusByPath.clear();

    // Shellcheck all open shell documents
    void this.triggerLintForEntireWorkspace();
  };

  private readonly handleDidOpenTextDocument = async (
    textDocument: vscode.TextDocument,
  ): Promise<void> => {
    try {
      await this.triggerLint(textDocument);
    } catch (error) {
      logging.error(`onDidOpenTextDocument: ${error}`);
    }
  };

  private readonly handleDidChangeTextDocument = async (
    textDocumentChangeEvent: vscode.TextDocumentChangeEvent,
  ): Promise<void> => {
    if (textDocumentChangeEvent.document.uri.scheme === "output") {
      /*
       * Special case: silently drop any event that comes from
       * an output channel. This avoids an endless feedback loop,
       * which would occur if this handler were to log something
       * to our own channel.
       * Output channels cannot be shell scripts anyway.
       */
      return;
    }
    try {
      await this.triggerLint(
        textDocumentChangeEvent.document,
        (settings) => settings.trigger === RunTrigger.onType,
      );
    } catch (error) {
      logging.error(`onDidChangeTextDocument: ${error}`);
    }
  };

  private readonly handleDidSaveTextDocument = async (
    textDocument: vscode.TextDocument,
  ): Promise<void> => {
    try {
      await this.triggerLint(textDocument, (settings) => settings.trigger === RunTrigger.onSave);
    } catch (error) {
      logging.error(`onDidSaveTextDocument ${error}`);
    }
  };

  private scheduleInitialLint(): void {
    setTimeout(() => {
      void this.triggerLintForEntireWorkspace();
    }, 0);
  }

  private async triggerLintForEntireWorkspace(): Promise<void> {
    for (const textDocument of vscode.workspace.textDocuments) {
      try {
        await this.triggerLint(textDocument);
      } catch (error) {
        logging.error(`triggerLintForEntireWorkspace: ${error}`);
      }
    }
  }

  public dispose(): void {
    this.codeActionCollection.clear();
    this.diagnosticCollection.dispose();
  }

  private async getSettings(textDocument: vscode.TextDocument): Promise<ShellCheckSettings> {
    if (!this.settingsByUri.has(textDocument.uri.toString())) {
      await this.updateConfiguration(textDocument);
    }
    return this.settingsByUri.get(textDocument.uri.toString())!;
  }

  private async updateConfiguration(textDocument: vscode.TextDocument) {
    const settings = await getWorkspaceSettings(this.context, textDocument);

    this.settingsByUri.set(textDocument.uri.toString(), settings);
    this.setResultCollections(textDocument.uri);

    if (settings.enabled && !this.toolStatusByPath.has(settings.executable.path)) {
      // Prompt user to update shellcheck binary when necessary
      let toolStatus: ToolStatus;
      try {
        toolStatus = {
          ok: true,
          version: await getToolVersion(settings.executable.path),
        };
      } catch (error: unknown) {
        logging.debug("Failed to get tool version: %O", error);
        await this.showShellCheckError(error, settings.executable.path);
        toolStatus = toolStatusByError(error);
      }
      this.toolStatusByPath.set(settings.executable.path, toolStatus);

      if (toolStatus.ok) {
        const versionString = toolStatus.version.version;
        if (settings.executable.bundled) {
          logging.info(`shellcheck (bundled) version: ${versionString}`);
        } else {
          logging.info(`shellcheck version: ${versionString}`);
          await tryPromptForUpdatingTool(toolStatus.version);
        }
      }
    }
  }

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
    const shellcheckDiagnostics = context.diagnostics.filter(
      (diagnostic) => diagnostic.source === "shellcheck",
    );

    const actions = shellcheckDiagnostics.flatMap((diagnostic) => {
      const ruleId = extractRuleId(diagnostic);
      if (!ruleId) {
        return [];
      }

      const openDocAction = new vscode.CodeAction(
        `ShellCheck: Show wiki for ${ruleId}`,
        vscode.CodeActionKind.QuickFix,
      );
      openDocAction.command = {
        title: openDocAction.title,
        command: CommandIds.openRuleDoc,
        arguments: [getWikiUrlForRule(ruleId)],
      };

      const disableAction = new vscode.CodeAction(
        `ShellCheck: Disable ${ruleId} for this line`,
        vscode.CodeActionKind.QuickFix,
      );
      disableAction.command = {
        title: disableAction.title,
        command: CommandIds.disableCheckForLine,
        arguments: [document, ruleId, diagnostic.range],
      };

      return [openDocAction, disableAction];
    });

    const results = this.codeActionCollection.get(document.uri.toString()) ?? [];
    const additionalActions = results
      .filter((result) => result.codeAction && result.diagnostic.range.contains(range))
      .map((result) => result.codeAction!);

    return [...actions, ...additionalActions];
  }

  public provideApi(): ShellCheckExtensionApi {
    return {
      apiVersion1: {
        registerDocumentFilter: this.registerDocumentFilter,
      },
    };
  }

  private registerDocumentFilter = (documentFilter: vscode.DocumentFilter) => {
    if (this.additionalDocumentFilters.has(documentFilter)) {
      // Duplicate request. Ignore.
      return vscode.Disposable.from();
    }
    this.additionalDocumentFilters.add(documentFilter);
    // A new language ID may provide new configuration defaults
    this.settingsByUri.clear();
    this.toolStatusByPath.clear();
    // Re-evaluate all open shell documents due to updated filters
    void this.triggerLintForEntireWorkspace();

    return {
      dispose: () => {
        this.additionalDocumentFilters.delete(documentFilter);
        // Reset configuration defaults
        this.settingsByUri.clear();
        this.toolStatusByPath.clear();
      },
    };
  };

  private isAllowedTextDocument(textDocument: vscode.TextDocument): boolean {
    const allowedDocumentSelector: vscode.DocumentSelector = [
      ...ShellCheckProvider.LANGUAGES,
      ...this.additionalDocumentFilters,
    ];
    return !!vscode.languages.match(allowedDocumentSelector, textDocument);
  }

  private async collectDiagnostics(textDocument: vscode.TextDocument) {
    const output: string[] = [
      "# ShellCheck Diagnostics Report\n",
      "## Document\n",
      `- URI: \`${textDocument.uri.toString()}\``,
      `- Language: \`${textDocument.languageId}\``,
      "",
    ];

    output.push("## ShellCheck\n");
    const settings: ShellCheckSettings = await this.getSettings(textDocument);
    const toolStatus = this.toolStatusByPath.get(settings.executable.path);
    if (toolStatus && toolStatus.ok) {
      output.push(
        `- Version: \`${toolStatus.version.version}\``,
        `- Bundled: \`${settings.executable.bundled}\``,
        "",
      );
    } else {
      output.push("- ShellCheck is not installed or not working", "");
    }

    const warnings: string[] = [];
    if (!this.isAllowedTextDocument(textDocument)) {
      warnings.push("- Document is not a shell script or is filtered out");
    }

    if (settings.ignoreFileSchemes.has(textDocument.uri.scheme)) {
      warnings.push(
        `- File scheme of document is ignored: ${textDocument.uri.scheme} not in \`${SHELLCHECK_SECTION}.ignoreFileSchemes\``,
      );
    }

    if (warnings.length > 0) {
      output.push("## Warnings\n", ...warnings, "");
    }
    const ext = vscode.extensions.getExtension("mads-hartmann.bash-ide-vscode");
    if (ext) {
      const bashIdeSection = vscode.workspace.getConfiguration("bashIde", textDocument);
      if (bashIdeSection.get<string>("shellcheckPath") !== "") {
        output.push(
          "## Notes about Bash IDE extension\n",
          "- Bash IDE also provides ShellCheck integration, which overlaps with the ShellCheck extension. To disable ShellCheck integration in Bash IDE, set `bashIde.shellcheckPath` to an empty string.",
          "",
        );
      }
    }

    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: output.join("\n"),
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  private async disableCheckForLine(
    textDocument: vscode.TextDocument,
    ruleId: string,
    range: vscode.Range,
  ) {
    if (!this.isAllowedTextDocument(textDocument)) {
      return;
    }
    const targetLine = textDocument.lineAt(range.start.line);
    const indent = targetLine.text.slice(
      0,
      Math.max(0, targetLine.firstNonWhitespaceCharacterIndex),
    );

    const textEdit = vscode.TextEdit.insert(
      new vscode.Position(range.start.line, targetLine.firstNonWhitespaceCharacterIndex),
      `# shellcheck disable=${ruleId}\n${indent}`,
    );

    const edit = new vscode.WorkspaceEdit();
    edit.set(textDocument.uri, [textEdit]);

    await vscode.workspace.applyEdit(edit);
  }

  private async triggerLint(
    textDocument: vscode.TextDocument,
    extraCondition: (settings: ShellCheckSettings) => boolean = () => true,
  ) {
    if (!this.isAllowedTextDocument(textDocument)) {
      return;
    }

    const settings: ShellCheckSettings = await this.getSettings(textDocument);
    if (
      !extraCondition(settings) ||
      !this.toolStatusByPath.get(settings.executable.path)!.ok ||
      settings.ignoreFileSchemes.has(textDocument.uri.scheme)
    ) {
      return;
    }

    if (!settings.enabled) {
      this.setResultCollections(textDocument.uri);
      return;
    }

    if (
      settings.fileMatcher.excludes(
        textDocument.fileName,
        getWorkspaceFolderPath(textDocument.uri, false),
      )
    ) {
      return;
    }

    const key = textDocument.uri.toString();
    let delayer = this.delayers.get(key);
    if (!delayer) {
      delayer = new ThrottledDelayer<void>(settings.trigger === RunTrigger.onType ? 250 : 0);
      this.delayers.set(key, delayer);
    }

    void delayer.trigger(() => this.runLint(textDocument, settings));
  }

  private async runLint(
    textDocument: vscode.TextDocument,
    settings: ShellCheckSettings,
  ): Promise<void> {
    const toolStatus = this.toolStatusByPath.get(settings.executable.path);
    if (!toolStatus || !toolStatus.ok) {
      return;
    }

    const executable = settings.executable;
    const parser = createParser(textDocument, {
      toolVersion: toolStatus.version,
      enableQuickFix: settings.enableQuickFix,
    });

    let args = ["-f", parser.outputFormat];
    if (settings.exclude.length > 0) {
      args = [...args, "-e", settings.exclude.join(",")];
    }

    const fileExt = path.extname(textDocument.fileName);
    if (fileExt === ".bash" || fileExt === ".ksh" || fileExt === ".dash") {
      args = [...args, "-s", fileExt.slice(1)];
    }

    if (settings.customArgs.length > 0) {
      args = [...args, ...settings.customArgs];
    }

    args = [...args, "-"];

    const initialCwd = settings.useWorkspaceRootAsCwd
      ? getWorkspaceFolderPath(textDocument.uri)
      : guessDocumentDirname(textDocument);
    const cwd = await ensureCurrentWorkingDirectory(initialCwd);

    const script = textDocument.getText().replaceAll("\r\n", "\n").replaceAll("\r", "\n");

    logging.debug("Spawn: (cwd=%s) %s %s", cwd, executable.path, args);

    try {
      const { stdout } = await execa(executable.path, args, {
        cwd,
        reject: false,
        windowsHide: true,
        input: script,
        encoding: "utf8",
      });

      const output = stdout ?? "";
      logging.trace("shellcheck response: %s", output);
      const result = output.length > 0 ? parser.parse(output) : null;
      this.setResultCollections(textDocument.uri, result);
    } catch (error) {
      await this.handleShellCheckExecutionError(error, executable.path);
    }
  }

  private setResultCollections(uri: vscode.Uri, results?: ParseResult[] | null) {
    if (!results || results.length === 0) {
      this.diagnosticCollection.delete(uri);
      this.codeActionCollection.delete(uri.toString());
      return;
    }

    const diagnostics = results.map((result) => result.diagnostic);
    this.diagnosticCollection.set(uri, diagnostics);
    this.codeActionCollection.set(uri.toString(), results);
  }

  private async showShellCheckError(err: unknown, executablePath?: string): Promise<void> {
    let message: string;
    let items: string[] = [];
    const missingExecutable = errorLooksLikeMissingExecutable(err);

    if (missingExecutable && executablePath && this.notifiedMissingExecutable.has(executablePath)) {
      return;
    }

    if (err && err instanceof Error) {
      const error = err as NodeJS.ErrnoException;
      if (missingExecutable) {
        message = `ShellCheck executable not found. Install ShellCheck or set '${SHELLCHECK_SECTION}.executablePath' to the binary location.`;
        items = ["Configure Path", "Installation Guide"];
      } else {
        message = `Failed to run shellcheck: [${error.code}] ${error.message}`;
      }
    } else {
      message = `Failed to run shellcheck: unknown error`;
    }

    const selected = await vscode.window.showErrorMessage(message, ...items);

    if (missingExecutable && executablePath) {
      this.notifiedMissingExecutable.add(executablePath);
    }

    if (selected === "Configure Path") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        `${SHELLCHECK_SECTION}.executablePath`,
      );
    } else if (selected === "Installation Guide") {
      await vscode.env.openExternal(
        vscode.Uri.parse("https://github.com/koalaman/shellcheck#installing"),
      );
    }
  }

  private async handleShellCheckExecutionError(
    error: unknown,
    executablePath: string,
  ): Promise<void> {
    logging.debug("Unable to start shellcheck: %O", error);
    await this.showShellCheckError(error, executablePath);
    this.toolStatusByPath.set(executablePath, toolStatusByError(error));
  }
}
