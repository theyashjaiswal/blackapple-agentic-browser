// BlackApple Agentic Browser — Core Types

export interface SessionOptions {
  viewport?: { width: number; height: number };
  userAgent?: string;
  javaScriptEnabled?: boolean;
  ignoreHTTPSErrors?: boolean;
}

export interface PoolOptions {
  /** Max concurrent contexts across ALL browsers */
  maxContexts: number;
  /** Max contexts per single Chromium process */
  maxContextsPerBrowser?: number;
  /** Min warm contexts to keep ready */
  minWarmContexts?: number;
  /** Kill context after N ms of inactivity */
  idleTimeoutMs?: number;
  /** Kill context after N ms since creation */
  maxLifetimeMs?: number;
  /** Kill context if browser process uses > N MB */
  maxContextMemoryMB?: number;
  /** RAM budget per node in MB — auto-calculates maxContexts if set */
  ramBudgetMB?: number;
}

export interface PoolStats {
  totalContexts: number;
  activeContexts: number;
  availableContexts: number;
  pendingAcquires: number;
  browsers: number;
  maxContexts: number;
  memoryUsageMB?: number;
}

export class PoolExhaustedError extends Error {
  override readonly name = 'PoolExhaustedError';
  override readonly message: string;

  constructor(maxContexts: number) {
    super(`Pool exhausted: ${maxContexts} contexts in use`);
    this.message = `Pool exhausted: ${maxContexts} contexts in use`;
  }
}
