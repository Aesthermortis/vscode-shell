import { format as utilFormat } from "node:util";
import * as vscode from "vscode";
import { LogLevel, type Arguments, type Logger } from "./types.js";

/**
 * Creates a formatted log line with consistently stamped metadata.
 * @param level Log level label.
 * @param format Format string.
 * @param data Arguments passed to the formatter.
 * @returns Formatted log line.
 */
function formatMessage(level: string, format: string, ...data: Arguments): string {
  const date = new Date();
  return `[${date.toISOString()}] [${level.toUpperCase()}] ${utilFormat(format, ...data)}`;
}

export class OutputChannelLogger implements Logger {
  constructor(private readonly channel: vscode.OutputChannel) {}

  trace(format: string, ...data: Arguments): void {
    this.channel.appendLine(formatMessage(LogLevel[LogLevel.trace], format, ...data));
  }

  debug(format: string, ...data: Arguments): void {
    this.channel.appendLine(formatMessage(LogLevel[LogLevel.debug], format, ...data));
  }

  info(format: string, ...data: Arguments): void {
    this.channel.appendLine(formatMessage(LogLevel[LogLevel.info], format, ...data));
  }

  warn(format: string, ...data: Arguments): void {
    this.channel.appendLine(formatMessage(LogLevel[LogLevel.warn], format, ...data));
  }

  error(format: string, ...data: Arguments): void {
    this.channel.appendLine(formatMessage(LogLevel[LogLevel.error], format, ...data));
  }
}
