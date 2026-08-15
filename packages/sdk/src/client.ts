// BlackApple Agentic Browser — TypeScript SDK
// AI agent-facing client: wraps REST API calls, provides typed session management.
// Install: npm install @blackapple/agentic-browser-sdk
//
// Usage:
//   import { BlackApple } from '@blackapple/agentic-browser-sdk';
//   const browser = new BlackApple({ baseUrl: 'http://localhost:3333' });
//   const session = await browser.sessions.acquire();
//   await browser.sessions.navigate(session.id, 'https://example.com');
//   const screenshot = await browser.sessions.screenshot(session.id);
//   await browser.sessions.release(session.id);

const DEFAULT_BASE = process.env.BLACKAPPLE_API || 'http://localhost:3333';

export interface SessionInfo {
  id: string;
  browserId: string;
  createdAt: string;
}

export interface PageMetrics {
  url: string;
  title: string;
  loadTime: number;
  status: number;
}

export interface PoolStats {
  totalContexts: number;
  activeContexts: number;
  availableContexts: number;
  pendingAcquires: number;
  browsers: number;
  maxContexts: number;
}

export interface HealthStatus {
  nodeId: string;
  status: string;
  poolReady: boolean;
  queueDepth: number;
  stats: PoolStats;
}

// ── Core Client ──────────────────────────────────────────────────────────────

export class BlackApple {
  readonly baseUrl: string;

  constructor(opts: { baseUrl?: string; apiKey?: string } = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
  }

  private authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  // ── Health ────────────────────────────────────────────────────────────────

  async health(): Promise<HealthStatus> {
    const r = await fetch(`${this.baseUrl}/health`);
    if (!r.ok) throw new Error(`Health check failed: ${r.status}`);
    return r.json() as Promise<HealthStatus>;
  }

  async stats(): Promise<PoolStats> {
    const r = await fetch(`${this.baseUrl}/v1/stats`);
    if (!r.ok) throw new Error(`Stats failed: ${r.status}`);
    return (await r.json() as { stats: PoolStats }).stats;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async acquire(opts?: { viewport?: { width: number; height: number } }): Promise<SessionInfo> {
    const r = await fetch(`${this.baseUrl}/v1/sessions/acquire`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(opts ?? {}),
    });
    if (!r.ok) throw new Error(`Acquire failed: ${r.status} ${await r.text()}`);
    return r.json() as Promise<SessionInfo>;
  }

  async release(sessionId: string): Promise<void> {
    const r = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/release`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!r.ok) throw new Error(`Release failed: ${r.status}`);
  }

  async navigate(sessionId: string, url: string, waitUntil = 'domcontentloaded'): Promise<PageMetrics> {
    const r = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/navigate`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ url, waitUntil }),
    });
    if (!r.ok) throw new Error(`Navigate failed: ${r.status}`);
    return r.json() as Promise<PageMetrics>;
  }

  async click(sessionId: string, selector: string): Promise<void> {
    const r = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/click`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ selector }),
    });
    if (!r.ok) throw new Error(`Click failed: ${r.status}`);
  }

  async fill(sessionId: string, selector: string, value: string): Promise<void> {
    const r = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/fill`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ selector, value }),
    });
    if (!r.ok) throw new Error(`Fill failed: ${r.status}`);
  }

  async type(sessionId: string, selector: string, text: string, delay?: number): Promise<void> {
    const r = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/type`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ selector, text, delay }),
    });
    if (!r.ok) throw new Error(`Type failed: ${r.status}`);
  }

  async screenshot(sessionId: string): Promise<Buffer> {
    const r = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/screenshot`);
    if (!r.ok) throw new Error(`Screenshot failed: ${r.status}`);
    const buf = await r.arrayBuffer();
    return Buffer.from(buf);
  }

  async evaluate<T = unknown>(sessionId: string, fn: string): Promise<T> {
    const r = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/evaluate`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ fn }),
    });
    if (!r.ok) throw new Error(`Evaluate failed: ${r.status}`);
    return r.json() as Promise<T>;
  }

  async pdf(sessionId: string): Promise<Buffer> {
    const r = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/pdf`);
    if (!r.ok) throw new Error(`PDF failed: ${r.status}`);
    const buf = await r.arrayBuffer();
    return Buffer.from(buf);
  }

  async title(sessionId: string): Promise<string> {
    return this.evaluate<string>(sessionId, 'document.title');
  }

  async getContent(sessionId: string): Promise<string> {
    return this.evaluate<string>(sessionId, 'document.documentElement.outerHTML');
  }
}

// ── Convenience: session-scoped runner ───────────────────────────────────────

export async function withSession<T>(
  opts: { baseUrl?: string; viewport?: { width: number; height: number } },
  fn: (session: SessionInfo, browser: BlackApple) => Promise<T>,
): Promise<T> {
  const browser = new BlackApple({ baseUrl: opts.baseUrl ?? DEFAULT_BASE });
  const session = await browser.acquire(opts);
  try {
    return await fn(session, browser);
  } finally {
    await browser.release(session.id).catch(() => {}); // best-effort
  }
}
