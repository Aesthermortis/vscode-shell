import * as fs from "node:fs";
import * as vscode from "vscode";
import { SHELLCHECK_SECTION } from "../constants.js";
import { FileMatcher } from "./utils/filematcher.js";
import type { FileSettings } from "./utils/filematcher.js";
import { substitutePath } from "./utils/path.js";

export interface Executable {
  path: string;
  bundled: boolean;
}

export interface ShellCheckSettings {
  enabled: boolean;
  enableQuickFix: boolean;
  executable: Executable;
  trigger: RunTrigger;
  exclude: string[];
  customArgs: string[];
  ignoreFileSchemes: Set<string>;
  useWorkspaceRootAsCwd: boolean;
  fileMatcher: FileMatcher;
}

export const SHELLCHECK_SETTING_KEYS = {
  enable: "enable",
  enableQuickFix: "enableQuickFix",
  executablePath: "executablePath",
  run: "run",
  exclude: "exclude",
  customArgs: "customArgs",
  ignorePatterns: "ignorePatterns",
  ignoreFileSchemes: "ignoreFileSchemes",
  useWorkspaceRootAsCwd: "useWorkspaceRootAsCwd",
} as const;

export enum RunTrigger {
  onSave,
  onType,
  manual,
}

export const RUN_TRIGGER_STRINGS = {
  onSave: "onSave",
  onType: "onType",
  manual: "manual",
} as const;

export type RunTriggerString = (typeof RUN_TRIGGER_STRINGS)[keyof typeof RUN_TRIGGER_STRINGS];

/**
 * Converts a configuration string into the corresponding run trigger.
 * @param value Raw configuration value.
 * @returns The normalised run trigger enum value.
 */
export function runTriggerFrom(value: string): RunTrigger {
  if (value === RUN_TRIGGER_STRINGS.onSave) {
    return RunTrigger.onSave;
  }

  if (value === RUN_TRIGGER_STRINGS.onType) {
    return RunTrigger.onType;
  }

  return RunTrigger.manual;
}

const validErrorCodePattern = /^(?:SC)?(\d{4})$/;

/**
 * Reads and normalises the ShellCheck configuration for the given scope.
 * @param context Extension context, used to resolve bundled binaries.
 * @param scope Optional configuration scope provided by VS Code.
 * @returns Resolved settings ready for lint execution.
 */
export async function getWorkspaceSettings(
  context: vscode.ExtensionContext,
  scope?: vscode.ConfigurationScope | null,
): Promise<ShellCheckSettings> {
  const keys = SHELLCHECK_SETTING_KEYS;
  const section = vscode.workspace.getConfiguration(SHELLCHECK_SECTION, scope);
  const settings = <ShellCheckSettings>{
    enabled: section.get(keys.enable, true),
    trigger: runTriggerFrom(section.get(keys.run, RUN_TRIGGER_STRINGS.onType)),
    exclude: section.get(keys.exclude, []),
    executable: await getExecutable(context, section.get(keys.executablePath)),
    customArgs: section.get(keys.customArgs, []).map((arg) => substitutePath(arg)),
    ignoreFileSchemes: new Set(section.get(keys.ignoreFileSchemes, ["git", "gitfs", "output"])),
    useWorkspaceRootAsCwd: section.get(keys.useWorkspaceRootAsCwd, false),
    enableQuickFix: section.get(keys.enableQuickFix, false),
    fileMatcher: new FileMatcher(),
  };

  // Filter excludes (#739), besides, tolerate error codes prefixed with "SC"
  const filteredExcludes: string[] = [];
  for (const pattern of settings.exclude) {
    const match = new RegExp(validErrorCodePattern).exec(pattern);
    if (match?.[1]) {
      filteredExcludes.push(match[1]);
    }
  }
  settings.exclude = filteredExcludes;

  const ignorePatterns: FileSettings = section.get(keys.ignorePatterns, {});
  settings.fileMatcher.configure(ignorePatterns);
  return settings;
}

/**
 * Determines if the ShellCheck configuration was affected by a change event.
 * @param e Configuration change event dispatched by VS Code.
 * @returns True when ShellCheck settings were modified.
 */
export function checkIfConfigurationChanged(e: vscode.ConfigurationChangeEvent): boolean {
  for (const key of Object.values(SHELLCHECK_SETTING_KEYS)) {
    const section = `${SHELLCHECK_SECTION}.${key}`;
    if (e.affectsConfiguration(section)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the executable path for ShellCheck, preferring the bundled binary when available.
 * @param context Extension context used to resolve bundled assets.
 * @param executablePath Optional user-provided executable override.
 * @returns The executable descriptor ready for use by the linter.
 */
async function getExecutable(
  context: vscode.ExtensionContext,
  executablePath: string | undefined,
): Promise<Executable> {
  if (!executablePath) {
    // Use bundled binaries (maybe)
    const suffix = process.platform === "win32" ? ".exe" : "";
    executablePath = context.asAbsolutePath(
      `./bin/${process.platform}-${process.arch}/shellcheck${suffix}`,
    );
    try {
      await fs.promises.access(executablePath, fs.constants.X_OK);
      return {
        path: executablePath,
        bundled: true,
      };
    } catch (accessError) {
      if ((accessError as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
        throw accessError;
      }
      return {
        path: "shellcheck", // Fallback to default shellcheck path.
        bundled: false,
      };
    }
  }

  return {
    path: substitutePath(executablePath),
    bundled: false,
  };
}
