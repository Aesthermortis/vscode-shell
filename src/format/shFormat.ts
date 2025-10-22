import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { parseSync } from "editorconfig";
import * as vscode from "vscode";
import { FORMAT_SECTION } from "../constants.js";
import { getEdits } from "./diff-utils.js";
import { getDestPath } from "./downloader.js";
import { output } from "./extension.js";
import { fileExists, substitutePath } from "./path-util.js";

export const configurationPrefix = FORMAT_SECTION;

export enum ConfigItemName {
  Flag = "flag",
  Path = "path",
  EffectLanguages = "effectLanguages",
  ShowError = "showError",
  UseEditorConfig = "useEditorConfig",
}

type ShfmtRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Provides shfmt-based formatting for shell documents.
 */
export class Formatter {
  private readonly diagnosticCollection: vscode.DiagnosticCollection;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
  ) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection("shell-format");
  }

  public async formatDocument(
    document: vscode.TextDocument,
    options?: vscode.FormattingOptions,
  ): Promise<vscode.TextEdit[]> {
    const start = new vscode.Position(0, 0);
    const end = new vscode.Position(
      document.lineCount - 1,
      document.lineAt(document.lineCount - 1).text.length,
    );
    const range = new vscode.Range(start, end);
    const content = document.getText(range);
    return this.formatDocumentWithContent(content, document, range, options);
  }

  public async formatDocumentWithContent(
    content: string,
    document: vscode.TextDocument,
    range: vscode.Range,
    options?: vscode.FormattingOptions,
  ): Promise<vscode.TextEdit[]> {
    const settings = vscode.workspace.getConfiguration(configurationPrefix);
    const configuredPath = getSettings<string | undefined>(ConfigItemName.Path);
    const userFlags = getSettings<string | undefined>(ConfigItemName.Flag);
    const useEditorConfig = settings.get<boolean>(ConfigItemName.UseEditorConfig) ?? false;
    const showErrorMessage = settings.get<boolean>(ConfigItemName.ShowError) ?? true;

    const command = this.resolveCommandPath(configuredPath);
    const args = this.buildArguments(document, options, userFlags, useEditorConfig);

    this.log.appendLine(`Running shfmt: ${command} ${args.join(" ")}`);

    let result: ShfmtRunResult;
    try {
      result = await this.runShfmt(command, args, content);
    } catch (error) {
      const message = `Failed to execute shfmt: ${String(error)}`;
      if (showErrorMessage) {
        await vscode.window.showErrorMessage(message);
      }
      throw new Error(message);
    }

    if (result.exitCode === 0) {
      this.diagnosticCollection.delete(document.uri);

      if (result.stdout.length === 0) {
        return [];
      }

      const filePatch = getEdits(document.fileName, content, result.stdout);
      return filePatch.edits.map((edit) => edit.apply());
    }

    this.reportDiagnostics(document, result.stderr);
    if (showErrorMessage) {
      await vscode.window.showErrorMessage(result.stderr || "shfmt exited with an error.");
    }
    throw new Error(result.stderr || `shfmt exited with code ${result.exitCode}`);
  }

  private resolveCommandPath(configuredPath: string | undefined): string {
    if (configuredPath && fileExists(configuredPath)) {
      return configuredPath;
    }

    if (configuredPath) {
      throw new Error(`Invalid shfmt path configured: ${configuredPath}`);
    }

    return getDestPath(this.context);
  }

  private buildArguments(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions | undefined,
    configuredFlags: string | undefined,
    useEditorConfig: boolean,
  ): string[] {
    const flags: string[] = [];
    let indentConfigured = false;

    if (document.fileName.endsWith(".bats")) {
      flags.push("--ln=bats");
    }

    let remainingFlags = configuredFlags?.trim() ?? "";

    if (useEditorConfig) {
      if (remainingFlags.length > 0) {
        output.appendLine("shfmt flags are ignored because EditorConfig mode is enabled.");
      }
      const editorConfigFlags = this.resolveEditorConfigOptions(document.fileName);
      if (editorConfigFlags.indentConfigured) {
        indentConfigured = true;
      }
      flags.push(...editorConfigFlags.flags);
      remainingFlags = "";
    }

    if (remainingFlags.length > 0) {
      if (remainingFlags.includes("-w")) {
        throw new Error(`Incompatible flag specified in ${FORMAT_SECTION}.flag: -w`);
      }
      if (remainingFlags.includes("-i")) {
        indentConfigured = true;
      }
      flags.push(...remainingFlags.split(/\s+/u).filter(Boolean));
    }

    if (options?.insertSpaces && !indentConfigured) {
      flags.push(`-i=${options.tabSize}`);
    }

    output.appendLine(`Effective shfmt flags: ${JSON.stringify(flags)}`);
    return flags;
  }

  private resolveEditorConfigOptions(fileName: string): {
    flags: string[];
    indentConfigured: boolean;
  } {
    try {
      const configResult = parseSync(fileName);
      const editorFlags: string[] = [];
      let indentConfigured = false;

      if (configResult.indent_style === "tab") {
        editorFlags.push("-i=0");
        indentConfigured = true;
      } else if (
        configResult.indent_style === "space" &&
        typeof configResult.indent_size === "number"
      ) {
        editorFlags.push(`-i=${configResult.indent_size}`);
        indentConfigured = true;
      }

      if (typeof configResult.shell_variant === "string") {
        editorFlags.push(`-ln=${configResult.shell_variant}`);
      }

      if (configResult.binary_next_line) {
        editorFlags.push("-bn");
      }
      if (configResult.switch_case_indent) {
        editorFlags.push("-ci");
      }
      if (configResult.space_redirects) {
        editorFlags.push("-sr");
      }
      if (configResult.keep_padding) {
        editorFlags.push("-kp");
      }
      if (configResult.function_next_line) {
        editorFlags.push("-fn");
      }

      return { flags: editorFlags, indentConfigured };
    } catch (error) {
      this.log.appendLine(`Unable to read EditorConfig for ${fileName}: ${String(error)}`);
      return { flags: [], indentConfigured: false };
    }
  }

  private async runShfmt(
    command: string,
    args: readonly string[],
    content: string,
  ): Promise<ShfmtRunResult> {
    return new Promise<ShfmtRunResult>((resolve, reject) => {
      const child: ChildProcessWithoutNullStreams = spawn(command, args, { stdio: "pipe" });
      const stdoutChunks: Uint8Array[] = [];
      const stderrChunks: Uint8Array[] = [];

      child.stdout.on("data", (chunk: Uint8Array) => {
        stdoutChunks.push(Buffer.from(chunk));
      });
      child.stderr.on("data", (chunk: Uint8Array) => {
        stderrChunks.push(Buffer.from(chunk));
      });
      child.on("error", reject);

      child.on("close", (code) => {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString(),
          stderr: Buffer.concat(stderrChunks).toString(),
          exitCode: code ?? 0,
        });
      });

      child.stdin.on("error", reject);
      child.stdin.write(content, (error) => {
        if (error) {
          reject(error);
        }
      });
      child.stdin.end();
    });
  }

  private reportDiagnostics(document: vscode.TextDocument, stderr: string): void {
    const match = /^<standard input>:(\d+):(\d+):/u.exec(stderr);
    if (!match) {
      return;
    }

    const line = Math.max(Number.parseInt(match[1], 10) - 1, 0);
    const column = Math.max(Number.parseInt(match[2], 10) - 1, 0);
    const range = new vscode.Range(
      new vscode.Position(line, column),
      new vscode.Position(line, column),
    );

    const diagnostic: vscode.Diagnostic = {
      range,
      message: stderr.slice(match[0].length),
      severity: vscode.DiagnosticSeverity.Error,
      source: "shfmt",
    };

    this.diagnosticCollection.set(document.uri, [diagnostic]);
  }
}

export class ShellDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
  private readonly settings: vscode.WorkspaceConfiguration;

  constructor(
    private readonly formatter: Formatter,
    settings?: vscode.WorkspaceConfiguration,
  ) {
    this.settings = settings ?? vscode.workspace.getConfiguration(configurationPrefix);
  }

  public provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): Thenable<vscode.TextEdit[]> {
    if (token.isCancellationRequested) {
      return Promise.resolve([]);
    }
    return this.formatter.formatDocument(document, options);
  }
}

/**
 * Retrieves an extension setting value, resolving workspace placeholders when needed.
 * @param key Configuration key to lookup.
 * @returns Setting value or undefined when not configured.
 */
export function getSettings<T = unknown>(key: string): T | undefined {
  const settings = vscode.workspace.getConfiguration(configurationPrefix);
  const pathSettingKey: string = ConfigItemName.Path;
  if (key === pathSettingKey) {
    const rawPath = settings.get<string | null>(key);
    if (typeof rawPath === "string" && rawPath.trim().length > 0) {
      return substitutePath(rawPath) as T;
    }
    return undefined;
  }

  const value = settings.get<T | null>(key);
  return value ?? undefined;
}
