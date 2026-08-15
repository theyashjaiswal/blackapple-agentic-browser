// BlackApple Agentic Browser — BrowserSession
// Lightweight wrapper around Playwright BrowserContext with BlackApple-specific helpers.

import type { BrowserContext, Page } from 'playwright';

export interface PageMetrics {
  url: string;
  title: string;
  loadTime: number;
  status: number;
}

export interface NavigateOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

export class BrowserSession {
  constructor(
    public readonly id: string,
    public readonly browserId: string,
    public readonly context: BrowserContext,
    public readonly createdAt: Date,
    public lastUsed: Date,
  ) {}

  // ── Navigation ───────────────────────────────────────────────────────────────

  async navigate(url: string, options: NavigateOptions = {}): Promise<PageMetrics> {
    const { waitUntil = 'domcontentloaded', timeout = 30_000 } = options;
    const start = Date.now();
    const page = await this.context.newPage();
    const response = await page.goto(url, { waitUntil, timeout });
    const metrics: PageMetrics = {
      url: page.url(),
      title: await page.title(),
      loadTime: Date.now() - start,
      status: response?.status() ?? 0,
    };
    await page.close();
    return metrics;
  }

  // ── Evaluation ─────────────────────────────────────────────────────────────

  async evaluate<T = unknown>(fn: string | (() => T)): Promise<T> {
    const page = await this.context.newPage();
    try {
      const result = await page.evaluate(typeof fn === 'function' ? fn : new Function(fn) as () => T);
      return result as T;
    } finally {
      await page.close();
    }
  }

  async evaluateOnDocument<T = unknown>(fn: string | (() => T)): Promise<T> {
    const page = await this.context.newPage();
    try {
      const fnStr = typeof fn === 'function' ? `(${fn.toString()})()` : fn;
      // @ts-expect-error CDP binding
      return await page.evaluateOnNewDocument(fnStr) as T;
    } finally {
      await page.close();
    }
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  async click(selector: string, options?: { timeout?: number; button?: 'left' | 'right' }): Promise<void> {
    const page = await this.context.newPage();
    try {
      await page.click(selector, { timeout: options?.timeout ?? 10_000, button: options?.button ?? 'left' });
    } finally {
      await page.close();
    }
  }

  async fill(selector: string, value: string): Promise<void> {
    const page = await this.context.newPage();
    try {
      await page.fill(selector, value);
    } finally {
      await page.close();
    }
  }

  async type(selector: string, text: string, options?: { delay?: number }): Promise<void> {
    const page = await this.context.newPage();
    try {
      await page.type(selector, text, options);
    } finally {
      await page.close();
    }
  }

  async waitForSelector(selector: string, options?: { timeout?: number; state?: 'visible' | 'hidden' | 'attached' }): Promise<void> {
    const page = await this.context.newPage();
    try {
      await page.waitForSelector(selector, { timeout: options?.timeout ?? 10_000, state: options?.state ?? 'visible' });
    } finally {
      await page.close();
    }
  }

  async $(selector: string): Promise<ReturnType<Page['$']>> {
    const page = await this.context.newPage();
    try {
      return await page.$(selector);
    } finally {
      await page.close();
    }
  }

  async $$(selector: string): Promise<ReturnType<Page['$$']>> {
    const page = await this.context.newPage();
    try {
      return await page.$$(selector);
    } finally {
      await page.close();
    }
  }

  async getContent(): Promise<string> {
    const page = await this.context.newPage();
    try {
      return page.content();
    } finally {
      await page.close();
    }
  }

  async title(): Promise<string> {
    const page = await this.context.newPage();
    try {
      return page.title();
    } finally {
      await page.close();
    }
  }

  // ── Screenshots / PDF ─────────────────────────────────────────────────────

  async screenshot(options?: { path?: string; fullPage?: boolean; type?: 'png' | 'jpeg' }): Promise<Buffer> {
    const page = await this.context.newPage();
    try {
      return await page.screenshot({ ...options }) as Buffer;
    } finally {
      await page.close();
    }
  }

  async pdf(options?: { path?: string; format?: 'A4' | 'Letter' }): Promise<Buffer> {
    const page = await this.context.newPage();
    try {
      return await page.pdf({ ...options, format: options?.format ?? 'A4' }) as Buffer;
    } finally {
      await page.close();
    }
  }

  // ── Network Interception ───────────────────────────────────────────────────

  async interceptRequests(handler: (route: { url: string; abort: () => void; continue: (opts?: { url?: string }) => void }) => void): Promise<void> {
    await this.context.route('**/*', async route => {
      const req = route.request();
      try {
        if (handler.length >= 3) {
          // old API compat
          await route.continue();
        } else {
          await route.continue();
        }
      } catch {
        await route.abort();
      }
    });
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}
