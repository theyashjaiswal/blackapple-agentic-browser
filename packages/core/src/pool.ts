// BlackApple Agentic Browser — Phase 1: Context Pooling
//
// CRITICAL ARCHITECTURE: We pool BrowserContext, NOT full browsers.
// One Chromium process + 20 contexts = ~300MB
// 20 browsers × 1 context = ~3GB
// Context pooling is 10x more memory efficient.

import { randomUUID } from 'crypto';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { BrowserSession } from './session.js';

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
  /** Ram budget per node in MB (auto-calculates maxContexts if not set) */
  ramBudgetMB?: number;
}

export interface Session {
  readonly id: string;
  readonly createdAt: Date;
  context: BrowserContext;
  browserId: string; // which BrowserManager owns this
  lastUsed: Date;
  close(): Promise<void>;
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

// ── BrowserManager ────────────────────────────────────────────────────────────
// Owns ONE Chromium process and manages contexts within it.

class BrowserManager {
  readonly id = randomUUID();
  private browser: Browser | null = null;
  private contexts: Set<BrowserContext> = new Set();
  readonly maxContexts: number;

  constructor(private options: {
    headless?: boolean;
    args?: string[];
    userAgent?: string;
  }, maxContextsPerBrowser: number) {
    this.maxContexts = maxContextsPerBrowser;
  }

  async launch(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: this.options.headless ?? true,
      args: this.options.args ?? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }

  async createContext(opts: SessionOptions = {}): Promise<BrowserContext> {
    if (!this.browser) await this.launch();
    const ctx = await this.browser!.newContext({
      viewport: opts.viewport ?? { width: 1280, height: 720 },
      userAgent: opts.userAgent ?? 'BlackApple/1.0 (+https://github.com/theyashjaiswal/blackapple-agentic-browser)',
      javaScriptEnabled: opts.javaScriptEnabled ?? true,
      ignoreHTTPSErrors: opts.ignoreHTTPSErrors ?? false,
    });
    this.contexts.add(ctx);
    return ctx;
  }

  async closeContext(ctx: BrowserContext): Promise<void> {
    try {
      await ctx.close();
    } catch { /* ignore */ }
    this.contexts.delete(ctx);
  }

  get activeCount(): number {
    return this.contexts.size;
  }

  get hasCapacity(): boolean {
    return this.contexts.size < this.maxContexts;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.contexts.clear();
  }
}

// ── PooledSession ──────────────────────────────────────────────────────────────
// PooledSession extends BrowserSession so callers get full browser API.
// Named PooledSession to avoid shadowing the exported BrowserSession class.

class PooledSession extends BrowserSession {
  constructor(
    context: BrowserContext,
    browserId: string,
  ) {
    super(
      randomUUID(),          // id
      browserId,             // browserId
      context,               // context
      new Date(),            // createdAt
      new Date(),            // lastUsed
    );
  }

  override async close(): Promise<void> {
    await this.context.close();
  }
}

// ── ContextPool ────────────────────────────────────────────────────────────────
// Manages one or more BrowserManagers, distributes contexts across them.
// This is the CORE class — it pools CONTEXTS, not browsers.

export class ContextPool {
  private managers: BrowserManager[] = [];
  private available: BrowserSession[] = [];
  private active: Map<string, BrowserSession> = new Map(); // sessionId → session
  private pending: Array<{
    resolve: (s: PooledSession) => void;
    reject: (e: Error) => void;
    createdAt: number;
  }> = [];

  private readonly maxContexts: number;
  private readonly maxPerBrowser: number;
  private readonly minWarm: number;
  private readonly idleTimeout: number;
  private readonly maxLifetime: number;

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(poolOptions: PoolOptions, private browserOptions: {
    headless?: boolean;
    args?: string[];
    userAgent?: string;
  } = {}) {
    this.maxContexts = poolOptions.maxContexts;
    this.maxPerBrowser = poolOptions.maxContextsPerBrowser ?? 20;
    this.minWarm = poolOptions.minWarmContexts ?? Math.min(2, this.maxContexts);
    this.idleTimeout = poolOptions.idleTimeoutMs ?? 60_000; // 1 min default
    this.maxLifetime = poolOptions.maxLifetimeMs ?? 1_800_000; // 30 min default
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Pre-warm with minWarm contexts spread across managers
    await this.ensureCapacity(this.minWarm);
    this.startCleanup();
  }

  async destroy(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.allSettled([
      ...this.available.map(s => s.close()),
      ...Array.from(this.active.values()).map(s => s.close()),
      ...this.managers.map(m => m.close()),
    ]);
    this.available = [];
    this.active.clear();
    this.managers = [];
    this.pending = [];
  }

  // ── Acquire / Release ─────────────────────────────────────────────────────

  async acquire(opts: SessionOptions = {}): Promise<PooledSession> {
    // 1. Warm session available — close its persistent pages to ensure fresh start.
  // Do NOT close the context — it's managed by the pool.
    const warm = this.available.pop();
    if (warm) {
      // Only close the pages, not the context (context belongs to the pool)
      await warm.resetPages();
      this.active.set(warm.id, warm);
      return warm;
    }

    // 2. Under max — create new
    if (this.active.size + this.available.length < this.maxContexts) {
      const session = await this.createSession(opts);
      this.active.set(session.id, session);
      return session;
    }

    // 3. At capacity — queue
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pending.findIndex(p => p.resolve === resolve);
        if (idx !== -1) this.pending.splice(idx, 1);
        reject(new Error(`Pool exhausted: ${this.maxContexts} contexts in use`));
      }, 30_000);

      this.pending.push({ resolve, reject, createdAt: Date.now() });
    });
  }

  release(session: PooledSession): void {
    this.releaseById(session.id);
  }

  releaseById(sessionId: string): void {
    const session = this.active.get(sessionId);
    if (!session) return;
    this.active.delete(sessionId);

    // If pool is oversized, close instead of return to warm
    const total = this.active.size + this.available.length;
    if (total > this.maxContexts) {
      session.close().catch(() => {});
      return;
    }

    session.lastUsed = new Date();
    this.available.push(session);
    this.drainPending();
  }

  getSession(sessionId: string): PooledSession | undefined {
    return this.active.get(sessionId);
  }

  private async createSession(opts: SessionOptions): Promise<PooledSession> {
    const manager = this.selectManager();
    const context = await manager.createContext(opts);
    return new PooledSession(context, manager.id);
  }

  // ── Manager Selection ──────────────────────────────────────────────────────

  private selectManager(): BrowserManager {
    // Pick manager with most capacity (least loaded)
    const withCapacity = this.managers.filter(m => m.hasCapacity);
    if (withCapacity.length > 0) {
      withCapacity.sort((a, b) => a.activeCount - b.activeCount);
      return withCapacity[0]!;
    }

    // All full — create new manager if under global max
    const totalContexts = this.managers.reduce((sum, m) => sum + m.activeCount, 0);
    if (totalContexts < this.maxContexts) {
      const mgr = new BrowserManager(this.browserOptions, this.maxPerBrowser);
      this.managers.push(mgr);
      return mgr;
    }

    // Truly at capacity — return least-loaded (will queue)
    this.managers.sort((a, b) => a.activeCount - b.activeCount);
    return this.managers[0]!;
  }

  private ensureCapacity(count: number): Promise<void> {
    return Promise.all(
      Array.from({ length: count }, () => this.createSession({}).then(s => this.available.push(s)))
    ).then(() => {});
  }

  // ── Pending Queue Drain ─────────────────────────────────────────────────────

  private drainPending(): void {
    while (this.pending.length > 0 && this.available.length > 0) {
      const p = this.pending.shift()!;
      const session = this.available.pop()!;
      session.lastUsed = new Date();
      this.active.set(session.id, session);
      p.resolve(session);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();

      // Evict idle sessions over timeout
      const idleEvict = this.available.filter(s => now - s.lastUsed.getTime() > this.idleTimeout);
      for (const s of idleEvict) {
        s.close().catch(() => {});
        this.available = this.available.filter(x => x.id !== s.id);
      }

      // Evict oldest sessions over lifetime
      const total = this.active.size + this.available.length;
      if (total <= this.minWarm) return;

      const excess = total - this.minWarm;
      const byAge = [...this.available].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const toRemove = byAge.slice(0, excess);
      for (const s of toRemove) {
        s.close().catch(() => {});
        this.available = this.available.filter(x => x.id !== s.id);
      }
    }, 30_000);
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

  stats(): PoolStats {
    return {
      totalContexts: this.maxContexts,
      activeContexts: this.active.size,
      availableContexts: this.available.length,
      pendingAcquires: this.pending.length,
      browsers: this.managers.length,
      maxContexts: this.maxContexts,
    };
  }
}

// Alias for backwards compat
export { ContextPool as SessionPool };
