/**
 * @file Ensures the running Node.js and npm versions satisfy the
 * engines requirements before allowing further script execution.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultFs = { existsSync, readFileSync };

/**
 * Get the major version number from a version string.
 * @param {string|number} v - The version string to parse.
 * @returns {number} - The major version number.
 */
export function major(v) {
  return Number.parseInt(String(v).split(".")[0], 10);
}

/**
 * Check whether `candidate` is within `parent` directory.
 * @param {string} parent - The parent directory to test against.
 * @param {string} candidate - The path to verify.
 * @returns {boolean} - True when the candidate stays within the parent tree.
 */
function isPathInside(parent, candidate) {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedParent === resolvedCandidate) {
    return true;
  }

  const relative = path.relative(resolvedParent, resolvedCandidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Extract npm version from npm_config_user_agent env variable.
 * @param {NodeJS.ProcessEnv} env - Environment variables bag.
 * @returns {string|null} - The npm version when found.
 */
function npmVersionFromUserAgent(env) {
  const ua = env.npm_config_user_agent || "";
  const match = ua.match(/npm\/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract npm version from npm_config_npm_version env variable.
 * @param {NodeJS.ProcessEnv} env - Environment variables bag.
 * @returns {string|null} - The npm version when found.
 */
function npmVersionFromConfigVar(env) {
  const npmConfigVersion = env.npm_config_npm_version;
  return npmConfigVersion || null;
}

/**
 * Extract npm version by inspecting the npm installation directory.
 * @param {NodeJS.ProcessEnv} env - Environment variables bag.
 * @param {FilesystemHooks} fsTools - Filesystem helper functions.
 * @returns {string|null} - The npm version when found.
 */
function npmVersionFromExecPath(env, fsTools) {
  const execpath = env.npm_execpath;
  if (!execpath || !path.isAbsolute(execpath)) {
    return null;
  }

  const baseDir = path.resolve(path.dirname(execpath), "..");
  const packageJsonPath = path.join(baseDir, "package.json");

  if (!isPathInside(baseDir, packageJsonPath)) {
    throw new Error("Resolved package.json path escapes npm directory.");
  }

  if (!fsTools.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const npmPackage = JSON.parse(fsTools.readFileSync(packageJsonPath, "utf8"));
    if (npmPackage && typeof npmPackage.version === "string") {
      return npmPackage.version;
    }
  } catch (error) {
    console.warn(
      `[engines] Unable to read npm version from npm_execpath: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return null;
}

/**
 * Get the npm version string.
 * Filesystem helpers contract.
 * @typedef {object} FilesystemHooks
 * @property {(path: string) => boolean} existsSync - `fs.existsSync`-compatible helper.
 * @property {(path: string, encoding: BufferEncoding) => string} readFileSync - File reader.
 */

/**
 * @param {object} [options] - Resolution options.
 * @param {NodeJS.ProcessEnv} [options.env] - Environment variables bag.
 * @param {FilesystemHooks} [options.fs] - Filesystem hooks used to read npm metadata.
 * @returns {string} - The npm version string.
 */
export function getNpmVersion({ env = process.env, fs = defaultFs } = {}) {
  const strategies = [
    () => npmVersionFromUserAgent(env),
    () => npmVersionFromConfigVar(env),
    () => npmVersionFromExecPath(env, fs),
  ];

  for (const readVersion of strategies) {
    const version = readVersion();
    if (version) {
      return version;
    }
  }

  throw new Error("Unable to determine npm version from environment.");
}

/**
 * Validate runtime against required engine versions.
 * @param {object} [options] - Validation options.
 * @param {string} options.nodeVersion - Detected Node.js version.
 * @param {string} options.npmVersion - Detected npm version.
 * @param {number} [options.requiredNodeMajor] - Required Node major version (defaults to 24).
 * @param {number} [options.requiredNpmMajor] - Required npm major version (defaults to 11).
 * @returns {{nodeVersion: string, npmVersion: string}} - Verified versions.
 */
export function validateEngines({
  nodeVersion,
  npmVersion,
  requiredNodeMajor = 24,
  requiredNpmMajor = 11,
} = {}) {
  if (!nodeVersion || !npmVersion) {
    throw new TypeError(
      `[engines] Unable to validate engine versions. Received node "${nodeVersion}", npm "${npmVersion}".`,
    );
  }

  const nodeMajor = major(nodeVersion);
  const npmMajor = major(npmVersion);

  if (Number.isNaN(nodeMajor) || Number.isNaN(npmMajor)) {
    throw new TypeError(
      `[engines] Unable to parse engine versions. Received node "${nodeVersion}", npm "${npmVersion}".`,
    );
  }

  if (nodeMajor < requiredNodeMajor || npmMajor < requiredNpmMajor) {
    const errorDetails = [
      `[engines] Node >=${requiredNodeMajor} and npm >=${requiredNpmMajor} are required.`,
      `Detected: node ${nodeVersion}, npm ${npmVersion}`,
      `[debug] npm_execpath=${process.env.npm_execpath || ""}`,
      `[debug] npm_config_user_agent=${process.env.npm_config_user_agent || ""}`,
    ].join("\n");

    throw new Error(errorDetails);
  }

  return { nodeVersion, npmVersion };
}

/**
 * Ensure current process satisfies engine requirements.
 * @param {object} [options] - Execution options.
 * @param {NodeJS.ProcessEnv} [options.env] - Environment variables.
 * @param {FilesystemHooks} [options.fs] - Filesystem hooks used to read npm metadata.
 * @param {string} [options.nodeVersion] - Override detected Node version.
 * @param {number} [options.requiredNodeMajor] - Required Node major version. Defaults to 24.
 * @param {number} [options.requiredNpmMajor] - Required npm major version. Defaults to 11.
 * @returns {{nodeVersion: string, npmVersion: string}} - Verified versions.
 */
export function ensureEngines({
  env = process.env,
  fs = defaultFs,
  nodeVersion = process.versions.node,
  requiredNodeMajor = 24,
  requiredNpmMajor = 11,
} = {}) {
  const npmVersion = getNpmVersion({ env, fs });
  return validateEngines({
    nodeVersion,
    npmVersion,
    requiredNodeMajor,
    requiredNpmMajor,
  });
}

/**
 * Determine whether the current module is executed directly.
 * @returns {boolean} - True when the script is the main entry point.
 */
function isMainScript() {
  if (!process.argv[1]) {
    return false;
  }

  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(process.argv[1]) === currentFile;
}

if (isMainScript()) {
  try {
    ensureEngines();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
