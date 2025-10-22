import { execa } from "execa";
import * as semver from "semver";
import * as vscode from "vscode";
import { SHELLCHECK_SECTION } from "../../constants.js";
import * as logging from "./logging/index.js";

export const MINIMUM_TOOL_VERSION = "0.7.0";

/**
 * Prompts the user to upgrade ShellCheck when the detected version is below the minimum.
 * @param version Parsed ShellCheck version.
 */
export async function tryPromptForUpdatingTool(version: semver.SemVer): Promise<void> {
  const disableVersionCheckUpdateSetting = new DisableVersionCheckUpdateSetting();
  if (disableVersionCheckUpdateSetting.isDisabled) {
    return;
  }

  if (semver.lt(version, MINIMUM_TOOL_VERSION)) {
    await promptForUpdatingTool(version.format(), disableVersionCheckUpdateSetting);
  }
}

/**
 * Parses the ShellCheck version string returned on stdout.
 * @param stdout ShellCheck output containing the version line.
 * @returns Parsed semantic version.
 */
export function parseToolVersion(stdout: string): semver.SemVer {
  const lower = stdout.toLowerCase();
  const prefix = "version:";
  const index = lower.indexOf(prefix);
  if (index === -1) {
    throw new Error(`Unexpected response from ShellCheck: ${stdout}`);
  }

  const remainder = stdout.slice(index + prefix.length).trim();
  const token = remainder.split(/\s/u)[0] ?? "";
  const normalized = token.startsWith("v") ? token.slice(1) : token;
  const version = semver.parse(normalized);
  if (!version) {
    throw new Error(`Unable to parse ShellCheck version: ${token}`);
  }

  return version;
}

/**
 * Executes the ShellCheck binary to determine its version.
 * @param executable Absolute path to the ShellCheck executable.
 * @returns Parsed semantic version from the binary.
 */
export async function getToolVersion(executable: string): Promise<semver.SemVer> {
  logging.debug(`Spawn: ${executable} -V`);
  const { stdout } = await execa(executable, ["-V"], { timeout: 5000 });

  return parseToolVersion(stdout);
}

/**
 * Displays the upgrade prompt and reacts to the user's choice.
 * @param currentVersion Current ShellCheck version.
 * @param disableVersionCheckUpdateSetting Setting helper used to persist dismissal.
 */
async function promptForUpdatingTool(
  currentVersion: string,
  disableVersionCheckUpdateSetting: DisableVersionCheckUpdateSetting,
) {
  const selected = await vscode.window.showInformationMessage(
    `The ShellCheck extension is better with a newer version of "shellcheck" (you got v${currentVersion}, v${MINIMUM_TOOL_VERSION} or newer is recommended)`,
    "Don't Show Again",
    "Update",
  );
  switch (selected) {
    case "Don't Show Again": {
      await disableVersionCheckUpdateSetting.persist();
      break;
    }
    case "Update": {
      await vscode.env.openExternal(
        vscode.Uri.parse("https://github.com/koalaman/shellcheck#installing"),
      );
      break;
    }
  }
}

export class DisableVersionCheckUpdateSetting {
  private static readonly KEY = "disableVersionCheck";
  private readonly config: vscode.WorkspaceConfiguration;
  public readonly isDisabled: boolean;

  constructor() {
    this.config = vscode.workspace.getConfiguration(SHELLCHECK_SECTION, null);
    this.isDisabled = this.config.get<boolean>(DisableVersionCheckUpdateSetting.KEY) ?? false;
  }

  public async persist(): Promise<void> {
    await this.config.update(DisableVersionCheckUpdateSetting.KEY, true, true);
  }
}
