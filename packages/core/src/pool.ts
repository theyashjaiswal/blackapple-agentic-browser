// BlackApple Agentic Browser — Session Pool
import { randomUUID } from 'crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BrowserLaunchOptions, SessionOptions, PoolOptions, PoolStats } from './types.js';
import { BrowserSession } from './session.js';
import { PoolExhaustedError } from './types.js';

export class BrowserEngine {
  private browser: Browser | null = null;
  private launched = false;
  private options: Required<BrowserLaunchOptions>;

  constructor(options: BrowserLaunchOptions = {}) {
    this.options = {
      headless: options.headless ?? true,
      args: options.args ?? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      userAgent: options.userAgent ?? 'BlackApple/1.0',
      timeout: options.timeout ?? 30000,
    };
  }

  async launch(): Promise<void> {
    if (this.launched) return;
    this.browser = await chromium.launch({
      headless: this.options.headless,
      args: this.options.args,
    });
    this.launched = true;
  }

  async createSession(sessionOptions: SessionOptions = {}): Promise<BrowserSession> {
    if (!this.browser) await this.launch();
    const context = await this.browser!.newContext({
      viewport: sessionOptions.viewport ?? { width: 1280, height: 720 },
      userAgent: sessionOptions.userAgent ?? this.options.userAgent,
      javaScriptEnabled: sessionOptions.javaScriptEnabled ?? true,
      ignoreHTTPSErrors: sessionOptions.ignoreHTTPSErrors ?? false,
    });
    const page = await context.newPage();
    const id = randomUUID();
    return new BrowserSession(id, context, page);
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.launched = false;
  }

  isLaunched(): boolean {
    return this.launched;
  }
}

export class SessionPool {
  private engine: BrowserEngine;
  private available: BrowserSession[] = [];
  private active: Map<string, BrowserSession> = new Map();
  private pending: Array<{
    resolve: (session: BrowserSession) => void;
    reject: (err: Error) => void;
    createdAt: number;
  }> = [];
  private options: Required<PoolOptions>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: PoolOptions, engineOptions: BrowserLaunchOptions = {}) {
    this.options = {
      maxSessions: options.maxSessions,
      minSessions: options.minSessions ?? 2,
      sessionTTL: options.sessionTTL ?? 300000,
      acquireTimeout: options.acquireTimeout ?? 30000,
    };
    this.engine = new BrowserEngine(engineOptions);
  }

  async initialize(): Promise<void> {
    await this.engine.launch();
    const promises = Array.from({ length: this.options.minSessions }, () =>
      this.engine.createSession().then(s => {
        this.available.push(s);
        this.active.set(s.id, s);
      })
    );
    await Promise.all(promises);
    this.startCleanup();
  }

  async acquire(): Promise<BrowserSession> {
    const available = this.available.pop();
    if (available && !available.isClosed) {
      this.active.set(available.id, available);
      return available;
    }

    if (this.active.size < this.options.maxSessions) {
      const session = await this.engine.createSession();
      this.active.set(session.id, session);
      return session;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pending.findIndex(p => p.resolve === resolve);
        if (idx !== -1) this.pending.splice(idx, 1);
        reject(new PoolExhaustedError(this.options.maxSessions));
      }, this.options.acquireTimeout);

      this.pending.push({ resolve, reject, createdAt: Date.now() });
    });
  }

  release(session: BrowserSession): void {
    if (!this.active.has(session.id)) return;

    if (this.available.length < this.options.minSessions) {
      this.available.push(session);
      this.active.delete(session.id);
      this.drainPending();
    } else {
      session.close().catch(() => {});
      this.active.delete(session.id);
    }
  }

  private drainPending(): void {
    while (this.pending.length > 0 && this.available.length > 0) {
      const pending = this.pending.shift();
      if (!pending) break;
      const session = this.available.pop()!;
      this.active.set(session.id, session);
      pending.resolve(session);
    }
  }

  stats(): PoolStats {
    return {
      active: this.active.size,
      available: this.available.length,
      pending: this.pending.length,
      total: this.options.maxSessions,
    };
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const toClose = this.available.filter(s => now - s.createdAt.getTime() > this.options.sessionTTL);
      for (const session of toClose) {
        session.close().catch(() => {});
        this.available = this.available.filter(s => s.id !== session.id);
      }
    }, 60000);
  }

  async destroy(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    const sessionsToClose = [
      ...Array.from(this.active.values()),
      ...this.available,
    ];
    await Promise.allSettled(sessionsToClose.map(s => s.close()));
    this.active.clear();
    this.available = [];
    this.pending = [];
    await this.engine.close();
  }
}
