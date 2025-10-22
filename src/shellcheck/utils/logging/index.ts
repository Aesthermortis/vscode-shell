import * as vscode from "vscode";
import {
  LogLevel,
  LogLevelMap,
  type Arguments,
  type Logger,
  type LogLevelNameType,
} from "./types.js";

let loggers: Logger[] = [];
let globalLogLevel: LogLevel;

/**
 * Registers a logger implementation to receive log events.
 * @param logger Logger instance to register.
 * @returns Disposable that removes the logger when invoked.
 */
export function registerLogger(logger: Logger): vscode.Disposable {
  loggers.push(logger);
  return {
    dispose: () => {
      loggers = loggers.filter((l) => l !== logger);
    },
  };
}

/**
 * Sets the global logging level that controls which events are emitted.
 * @param level Optional textual log level.
 */
export function setLoggingLevel(level?: LogLevelNameType): void {
  globalLogLevel = LogLevelMap.get(level) ?? LogLevel.error;
}

/**
 * Emits an error log event when the configured level allows it.
 * @param format Message format string.
 * @param args Additional arguments used to format the log message.
 */
export function error(format: string, ...args: Arguments): void {
  if (globalLogLevel <= LogLevel.error) {
    for (const logger of loggers) {
      logger.error(format, ...args);
    }
  }
}

/**
 * Emits a warning log event when the configured level allows it.
 * @param format Message format string.
 * @param args Additional arguments used to format the log message.
 */
export function warn(format: string, ...args: Arguments): void {
  if (globalLogLevel <= LogLevel.warn) {
    for (const logger of loggers) {
      logger.warn(format, ...args);
    }
  }
}

/**
 * Emits an informational log event when the configured level allows it.
 * @param format Message format string.
 * @param args Additional arguments used to format the log message.
 */
export function info(format: string, ...args: Arguments): void {
  if (globalLogLevel <= LogLevel.info) {
    for (const logger of loggers) {
      logger.info(format, ...args);
    }
  }
}

/**
 * Emits a debug log event when the configured level allows it.
 * @param format Message format string.
 * @param args Additional arguments used to format the log message.
 */
export function debug(format: string, ...args: Arguments): void {
  if (globalLogLevel <= LogLevel.debug) {
    for (const logger of loggers) {
      logger.debug(format, ...args);
    }
  }
}

/**
 * Emits a trace log event when the configured level allows it.
 * @param format Message format string.
 * @param args Additional arguments used to format the log message.
 */
export function trace(format: string, ...args: Arguments): void {
  if (globalLogLevel <= LogLevel.trace) {
    for (const logger of loggers) {
      logger.trace(format, ...args);
    }
  }
}
