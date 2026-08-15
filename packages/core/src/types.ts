// BlackApple Agentic Browser — Core Types

export interface BrowserLaunchOptions {
  headless?: boolean;
  args?: string[];
  userAgent?: string;
  timeout?: number;
}

export interface SessionOptions {
  viewport?: { width: number; height: number };
  userAgent?: string;
  javaScriptEnabled?: boolean;
  ignoreHTTPSErrors?: boolean;
}

export interface PageMetrics {
  url: string;
  title: string;
  content: string;
  screenshot?: Buffer;
}

export interface NavigateOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  timeout?: number;
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  timeout?: number;
}

export interface TypeOptions {
  delay?: number;
  timeout?: number;
}

export interface EvaluateOptions {
  timeout?: number;
}

export interface SessionInfo {
  id: string;
  createdAt: Date;
  url: string;
  isActive: boolean;
}

export interface PoolStats {
  active: number;
  available: number;
  pending: number;
  total: number;
}

export interface PoolOptions {
  maxSessions: number;
  minSessions?: number;
  sessionTTL?: number; // ms
  acquireTimeout?: number; // ms
}

export class BlackAppleError extends Error {
  constructor(
    message: string,
    public code: string,
    public sessionId?: string
  ) {
    super(message);
    this.name = 'BlackAppleError';
  }
}

export class SessionNotFoundError extends BlackAppleError {
  constructor(sessionId: string) {
    super(`Session '${sessionId}' not found`, 'SESSION_NOT_FOUND', sessionId);
  }
}

export class PoolExhaustedError extends BlackAppleError {
  constructor(max: number) {
    super(`Session pool exhausted (max=${max})`, 'POOL_EXHAUSTED');
  }
}

export class TimeoutError extends BlackAppleError {
  constructor(operation: string, ms: number) {
    super(`${operation} timed out after ${ms}ms`, 'TIMEOUT');
  }
}
