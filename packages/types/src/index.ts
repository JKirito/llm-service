/**
 * Shared TypeScript types for the LLM service monorepo
 */

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  content: string;
  role: "user" | "assistant" | "system";
  timestamp: Date;
  userId: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface LogLevel {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: Date;
  context?: string;
}
