/**
 * Shared utilities for the LLM service monorepo
 */

export function formatMessage(message: string, context?: string): string {
  if (context) {
    return `[${context}] ${message}`;
  }
  return message;
}

export function createId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Logger {
  constructor(private context: string) {}

  info(message: string, ...args: any[]): void {
    console.log(formatMessage(message, this.context), ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(formatMessage(message, this.context), ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(formatMessage(message, this.context), ...args);
  }
}
