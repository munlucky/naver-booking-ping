/**
 * Simple logger with file output
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_WEIGHTS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export class Logger {
  constructor(
    private level: LogLevel = 'INFO',
    private logFile?: string
  ) {
    if (logFile) {
      const dir = dirname(logFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_WEIGHTS[level] >= LOG_LEVEL_WEIGHTS[this.level];
  }

  private format(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  private write(level: LogLevel, message: string): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.format(level, message);
    console.log(formatted);

    if (this.logFile) {
      appendFileSync(this.logFile, formatted + '\n');
    }
  }

  debug(message: string): void {
    this.write('DEBUG', message);
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  error(message: string, error?: unknown): void {
    if (error) {
      const errStr = error instanceof Error ? error.stack || error.message : String(error);
      this.write('ERROR', `${message}\n${errStr}`);
    } else {
      this.write('ERROR', message);
    }
  }
}

export function createLogger(level: LogLevel, logFile?: string): Logger {
  return new Logger(level, logFile);
}
