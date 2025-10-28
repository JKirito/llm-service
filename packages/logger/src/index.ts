import winston from "winston";

export class Logger {
  private winston: winston.Logger;

  constructor(context: string) {
    this.winston = winston.createLogger({
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: { context },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, context }) => {
              return `${timestamp} [${level}] [${context}] ${message}`;
            }),
          ),
        }),
      ],
    });
  }

  debug(message: string, ...args: unknown[]): void {
    this.winston.debug(message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.winston.info(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.winston.warn(message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.winston.error(message, ...args);
  }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}
