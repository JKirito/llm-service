import type { LogLevel } from "@llm-service/types";

export class Logger {
  constructor(private context: string) {}

  private log(
    level: LogLevel["level"],
    message: string,
    ...args: unknown[]
  ): void {
    const logEntry: LogLevel = {
      level,
      message,
      timestamp: new Date(),
      context: this.context,
    };

    const formattedMessage = `[${logEntry.timestamp.toISOString()}] [${level.toUpperCase()}] [${this.context}] ${message}`;

    switch (level) {
      case "debug":
      case "info":
        console.log(formattedMessage, ...args);
        break;
      case "warn":
        console.warn(formattedMessage, ...args);
        break;
      case "error":
        console.error(formattedMessage, ...args);
        break;
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.log("debug", message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log("info", message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log("warn", message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log("error", message, ...args);
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}
