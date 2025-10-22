import * as child_process from "node:child_process";
import * as fs from "node:fs";
import { IncomingMessage } from "node:http";
import * as https from "node:https";
import path from "node:path";
import * as vscode from "vscode";
import { config } from "./config.js";
import { shellformatPath } from "./extension.js";
import { getSettings } from "./shFormat.js";

const MaxRedirects = 10;
type DownloadProgressHandler = (
  downloadedBytes: number,
  totalBytes: number | undefined,
  previousBytes: number,
) => void;

/**
 * Type guard that narrows an unknown value to a string.
 * @param value Value to inspect.
 * @returns True when the provided value is a string.
 */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Normalizes Node.js header values into a string array.
 * @param header Raw header value returned by the HTTP client.
 * @returns Array containing every string entry from the header.
 */
function getHeaderValues(header: string | string[] | undefined): string[] {
  if (typeof header === "string") {
    return [header];
  }

  if (Array.isArray(header)) {
    const values: string[] = [];
    for (const value of header) {
      if (isString(value)) {
        values.push(value);
      }
    }
    return values;
  }

  return [];
}

/**
 * Parses the content-length header into a numeric byte count.
 * @param header Raw header value returned by the HTTP client.
 * @returns Parsed size in bytes, when available.
 */
function getContentLength(header: string | string[] | undefined): number | undefined {
  const headerValues = getHeaderValues(header);
  for (const value of headerValues) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

/**
 * Extracts a human readable message from an unknown error value.
 * @param error Error-like value thrown by asynchronous callbacks.
 * @returns String representation suitable for logging or error messages.
 */
function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }

  if (typeof error === "symbol") {
    return error.toString();
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error object";
    }
  }

  return "Unknown error";
}

/**
 * Normalizes unknown errors into Error instances.
 * @param error Error-like value thrown by asynchronous callbacks.
 * @returns Node.js Error instance containing a best-effort message.
 */
function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(getErrorMessage(error));
}

/**
 * Executes a single HTTPS GET request and resolves with the response stream.
 * @param url Fully qualified request URL.
 * @returns Incoming message object for the requested resource.
 */
async function requestOnce(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, resolve);
    request.on("error", reject);
  });
}

/**
 * Follows HTTP redirects (up to the configured maximum) and returns the final response.
 * @param url Request URL.
 * @param remainingRedirects Remaining redirects allowed before aborting.
 * @returns Final response and URL after following redirects.
 */
async function requestWithRedirects(
  url: string,
  remainingRedirects = MaxRedirects,
): Promise<{ response: IncomingMessage; finalUrl: string }> {
  const response = await requestOnce(url);
  const statusCode = response.statusCode ?? 0;

  if (statusCode >= 300 && statusCode < 400) {
    const locationHeader = response.headers.location;
    if (!locationHeader) {
      response.resume();
      throw new Error(`Redirect response from ${url} is missing a Location header.`);
    }

    if (remainingRedirects <= 0) {
      response.resume();
      throw new Error(`Too many HTTP redirects when requesting ${url}`);
    }

    const redirectUrl = new URL(locationHeader, url).toString();
    response.resume();
    return requestWithRedirects(redirectUrl, remainingRedirects - 1);
  }

  if (statusCode < 200 || statusCode >= 300) {
    response.resume();
    throw new Error(`HTTP status ${statusCode}: ${response.statusMessage ?? ""}`.trim());
  }

  return { response, finalUrl: url };
}

/**
 * Downloads a remote binary file to the specified destination, following redirects and reporting progress.
 * @param srcUrl Source URL for the download.
 * @param destPath Absolute path where the binary should be stored.
 * @param progress Optional callback receiving progress updates.
 */
export async function download2(
  srcUrl: string,
  destPath: string,
  progress?: DownloadProgressHandler,
): Promise<void> {
  const { response } = await requestWithRedirects(srcUrl);

  const expectedContentType = "application/octet-stream";
  const contentTypes = getHeaderValues(response.headers["content-type"]);
  const isOctetStream = contentTypes.some((value) => value.includes(expectedContentType));

  if (!isOctetStream) {
    response.resume();
    throw new Error("HTTP response does not contain an octet stream");
  }

  // The destination resides inside the extension directory; normalize the path for safety.
  const normalizedDest = path.normalize(destPath);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileStream = fs.createWriteStream(normalizedDest, { mode: 0o755 });
  const totalBytes = getContentLength(response.headers["content-length"]);

  await new Promise<void>((resolve, reject) => {
    let downloadedBytes = 0;

    const handleError = (error: unknown) => {
      if (!fileStream.destroyed) {
        fileStream.destroy();
      }
      if (!response.destroyed) {
        response.destroy();
      }
      reject(normalizeError(error));
    };

    response.on("data", (chunk: Buffer) => {
      const previousBytes = downloadedBytes;
      downloadedBytes += chunk.length;
      progress?.(downloadedBytes, totalBytes, previousBytes);
    });

    response.on("error", handleError);
    fileStream.on("error", handleError);
    fileStream.on("finish", resolve);

    response.pipe(fileStream);
  });
}

enum Arch {
  arm = "arm",
  arm64 = "arm64",
  i386 = "386",
  mips = "mips",
  x64 = "amd64",
  unknown = "unknown",
}

enum Platform {
  darwin = "darwin",
  freebsd = "freebsd",
  linux = "linux",
  netbsd = "netbsd",
  openbsd = "openbsd",
  windows = "windows",
  unknown = "unknown",
}

/**
 * Deduces the archive suffix based on the current CPU architecture.
 * @returns Platform-specific architecture identifier used by the shfmt releases.
 */
export function getArchExtension(): Arch {
  switch (process.arch) {
    case "arm": {
      return Arch.arm;
    }
    case "arm64": {
      return Arch.arm64;
    }
    case "ia32": {
      return Arch.i386;
    }
    case "x64": {
      return Arch.x64;
    }
    case "mips": {
      return Arch.mips;
    }
    default: {
      return Arch.unknown;
    }
  }
}

/**
 * Resolves the executable file extension for the current OS.
 * @returns `.exe` on Windows, otherwise an empty string.
 */
function getExecutableFileExt(): string {
  return process.platform === "win32" ? ".exe" : "";
}

/**
 * Maps Node's platform identifier to the shfmt platform token.
 * @returns The shfmt platform string for the current OS.
 */
export function getPlatform(): Platform {
  switch (process.platform) {
    case "win32": {
      return Platform.windows;
    }
    case "freebsd": {
      return Platform.freebsd;
    }
    case "openbsd": {
      return Platform.openbsd;
    }
    case "darwin": {
      return Platform.darwin;
    }
    case "linux": {
      return Platform.linux;
    }
    default: {
      return Platform.unknown;
    }
  }
}

/**
 * Builds the filename used by shfmt release assets for the current platform and architecture.
 * @returns Release asset filename.
 */
export function getPlatFormFilename(): string {
  const arch = getArchExtension();
  const platform = getPlatform();
  if (arch === Arch.unknown || platform === Platform.unknown) {
    throw new Error("do not find release shfmt for your platform");
  }
  return `shfmt_${config.shfmtVersion}_${platform}_${arch}${getExecutableFileExt()}`;
}

/**
 * Computes the GitHub release URL for the configured shfmt version.
 * @returns Fully qualified download URL.
 */
export function getReleaseDownloadUrl(): string {
  // https://github.com/mvdan/sh/releases/download/v2.6.4/shfmt_v2.6.4_darwin_amd64
  return `https://github.com/mvdan/sh/releases/download/${
    config.shfmtVersion
  }/${getPlatFormFilename()}`;
}

/**
 * Determines where the shfmt binary should be stored.
 * @param context VS Code extension context.
 * @returns Absolute destination path for the binary.
 */
export function getDestPath(context: vscode.ExtensionContext): string {
  const configuredPath = getSettings("path");
  const shfmtPath = typeof configuredPath === "string" ? configuredPath : undefined;
  return shfmtPath || path.join(context.extensionPath, "bin", getPlatFormFilename());
}

/**
 * Ensures the provided directory exists, creating parent folders when necessary.
 * @param dir Directory path that should exist.
 */
async function ensureDirectory(dir: string): Promise<void> {
  const normalizedDir = path.normalize(dir);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.promises.mkdir(normalizedDir, { recursive: true });
}

/**
 * Ensures the shfmt binary is installed and up to date, downloading it when required.
 * @param context Extension context providing storage locations.
 * @param output Output channel used to surface progress messages.
 */
export async function checkInstall(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
  if (!config.needCheckInstall) {
    return;
  }
  const destPath = getDestPath(context);
  await ensureDirectory(path.dirname(destPath));
  const needDownload = await checkNeedInstall(destPath, output);
  if (needDownload) {
    output.show();
    try {
      await cleanFile(destPath);
    } catch (error) {
      output.appendLine(
        `clean old file failed:[ ${destPath} ] ,please delete it manually (${String(error)})`,
      );
      output.show();
      return;
    }
    const url = getReleaseDownloadUrl();
    try {
      output.appendLine("Shfmt will be downloaded automatically!");
      output.appendLine(`download url: ${url}`);
      output.appendLine(`download to: ${destPath}`);
      output.appendLine(
        `If the download fails, you can manually download it to the dest directory.`,
      );
      output.appendLine(
        `Or download to another directory, and then set "${shellformatPath}" as the path`,
      );
      output.appendLine(`download shfmt page: https://github.com/mvdan/sh/releases`);
      output.appendLine(`You can't use this plugin until the download is successful.`);
      output.show();
      await download2(url, destPath, (downloaded, total, previous) => {
        if (
          typeof total === "number" &&
          Number.isFinite(total) &&
          total > 0 &&
          Math.floor(previous / 5) < Math.floor(downloaded / 5)
        ) {
          const percentage = ((downloaded / total) * 100).toFixed(2);
          output.appendLine(`downloaded:[${percentage}%]`);
          return;
        }

        output.append(".");
      });
      output.appendLine(`download success, You can use it successfully!`);
      output.appendLine(
        "Start or issues can be submitted here https://github.com/Aesthermortis/vscode-shell/issues",
      );
    } catch (error) {
      output.appendLine(`download failed: ${String(error)}`);
    }
    output.show();
  }
}

/**
 * Deletes the given file, ignoring missing-file errors.
 * @param file Absolute path to the file that should be removed.
 */
async function cleanFile(file: string): Promise<void> {
  const normalizedPath = path.normalize(file);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.promises.unlink(normalizedPath);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Determines whether a fresh shfmt download is required.
 * @param dest Path to the shfmt binary within the extension.
 * @param output Output channel for logging status messages.
 * @returns True when a download needs to occur.
 */
async function checkNeedInstall(dest: string, output: vscode.OutputChannel): Promise<boolean> {
  try {
    const configPathSetting = getSettings("path");
    if (typeof configPathSetting === "string" && configPathSetting.length > 0) {
      try {
        const resolvedConfigPath = path.resolve(configPathSetting);
        const accessMode =
          process.platform === "win32" ? fs.constants.F_OK : fs.constants.F_OK | fs.constants.X_OK;
        await fs.promises.access(resolvedConfigPath, accessMode);
        config.needCheckInstall = false;
        return false;
      } catch (error) {
        output.appendLine(
          `"${shellformatPath}": "${configPathSetting}" is configured, but the file is not executable or missing (${String(error)}). Attempting to download shfmt automatically.`,
        );
      }
    }

    const version = await getInstalledVersion(dest);

    const needInstall = version !== config.shfmtVersion;
    if (needInstall) {
      output.appendLine(`current shfmt version : ${version} is older than ${config.shfmtVersion}`);
    } else {
      config.needCheckInstall = false;
    }
    return needInstall;
  } catch (error) {
    output.appendLine(`shfmt hasn't downloaded yet! ${String(error)}`);
    output.show();
    return true;
  }
}

/**
 * Returns the version string reported by an existing shfmt binary.
 * @param dest Absolute path to the shfmt executable.
 * @returns Installed version string.
 */
async function getInstalledVersion(dest: string): Promise<string> {
  const normalizedDest = path.normalize(dest);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const stat = await fs.promises.stat(normalizedDest);
  if (stat.isFile()) {
    const v = child_process.execFileSync(normalizedDest, ["--version"], {
      encoding: "utf8",
    });
    return v.replace("\n", "");
  } else {
    throw new Error(`[${dest}] is not file`);
  }
}

/**
 * Narrows unknown errors to Node.js errno exceptions.
 * @param error Error value thrown by filesystem operations.
 * @returns True when the error exposes a `code` property.
 */
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
