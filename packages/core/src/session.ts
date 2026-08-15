// BlackApple Agentic Browser — BrowserSession
// Wraps Playwright BrowserContext with BlackApple API.
// Supports multi-tab: open/close/switch pages within a single session.
// Auth state (cookies, localStorage) persists across pages within the same context.

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
  // Multi-page array: pages are always at their index (no null-marking on close).
  // When a page is closed via closePage(), it's spliced out and activeIndex is clamped.
  // Public so PooledSession can reset them directly on reacquire (no async page-close).
  public _pages: Page[] = [];
  public _activeIndex = 0;

  constructor(
    public readonly id: string,
    public readonly browserId: string,
    public readonly context: BrowserContext,
    public readonly createdAt: Date,
    public lastUsed: Date,
  ) {}

  // ── Page Access ─────────────────────────────────────────────────────────

  private activePage(): Page {
    const page = this._pages[this._activeIndex];
    if (!page || page.isClosed()) {
      throw new Error('No active page. Call navigate() or newPage() first.');
    }
    return page;
  }

  private getPage(index: number): Page | null {
    if (index < 0 || index >= this._pages.length) return null;
    const page = this._pages[index];
    if (!page || page.isClosed()) return null;
    return page;
  }

  /** Switch to a specific page by index. */
  async switchPage(index: number): Promise<void> {
    if (index < 0 || index >= this._pages.length) {
      throw new RangeError(`Page index ${index} is out of range (${this._pages.length} open pages)`);
    }
    const page = this._pages[index];
    if (!page || page.isClosed()) {
      throw new Error(`Page at index ${index} has been closed`);
    }
    this._activeIndex = index;
    this.lastUsed = new Date();
  }

  /** Number of open pages in this session. */
  pageCount(): number {
    return this._pages.filter(p => !p.isClosed()).length;
  }

  /** Create a new page on the session's context. Used by pool health checks. */
  async createPage(): Promise<Page | null> {
    try {
      const page = await this.context.newPage();
      this._pages.push(page);
      return page;
    } catch {
      return null;
    }
  }

  /** URLs of all open pages. */
  pageUrls(): string[] {
    return this._pages.filter(p => !p.isClosed()).map(p => p.url());
  }

  // ── Navigation ─────────────────────────────────────────────────────────

  /** Navigate active page to URL. Creates a page if none exist.
   *  CRITICAL: after closePage(), _pages shrinks but _activeIndex still points to
   *  a valid index. navigate() uses the active page directly, NOT getPage(index).
   *  This correctly handles the "switch then navigate" pattern: switchPage(0) then
   *  navigate('...') always navigates tab 0 even if closePage(1) happened before. */
  async navigate(url: string, options: NavigateOptions = {}): Promise<PageMetrics> {
    const { waitUntil = 'domcontentloaded', timeout = 30_000 } = options;
    const start = Date.now();
    // Use _pages[_activeIndex] directly — if closePage removed the page at this
    // index, _activeIndex was already clamped and the slot is gone from the array.
    // In that case _pages[_activeIndex] is the NEXT valid page or undefined.
    let page = this._pages[this._activeIndex];
    if (!page || page.isClosed()) {
      // No page at active index — create a new one at this exact index
      page = await this.context.newPage();
      this._pages[this._activeIndex] = page;
    }
    try {
      const response = await page.goto(url, { waitUntil, timeout });
      this.lastUsed = new Date();
      return {
        url: page.url(),
        title: await page.title(),
        loadTime: Date.now() - start,
        status: response?.status() ?? 0,
      };
    } catch {
      // Unreachable domain / network error — return status 0 without throwing
      this.lastUsed = new Date();
      return { url, title: '', loadTime: Date.now() - start, status: 0 };
    }
  }

  // ── Multi-Tab ─────────────────────────────────────────────────────────

  /** Create a new blank page/tab. Returns its index. */
  async newPage(): Promise<number> {
    const page = await this.context.newPage();
    this._pages.push(page);
    this.lastUsed = new Date();
    return this._pages.length - 1;
  }

  /** Open a URL in a new tab. Returns tab index. */
  async openTab(url: string, switchTo = true, options: NavigateOptions = {}): Promise<number> {
    const page = await this.context.newPage();
    this._pages.push(page);
    const index = this._pages.length - 1;
    if (switchTo) this._activeIndex = index;
    await page.goto(url, {
      waitUntil: options.waitUntil ?? 'domcontentloaded',
      timeout: options.timeout ?? 30_000,
    });
    this.lastUsed = new Date();
    return index;
  }

  /** Close a specific page by index, or active page if no index provided. */
  async closePage(index?: number): Promise<void> {
    const targetIndex = index ?? this._activeIndex;
    const page = this.getPage(targetIndex);
    if (!page) throw new Error(`No page at index ${targetIndex} to close`);
    await page.close();
    this._pages.splice(targetIndex, 1);
    if (this._pages.length === 0) {
      this._activeIndex = 0;
    } else if (index === undefined || targetIndex <= this._activeIndex) {
      this._activeIndex = Math.min(this._activeIndex, this._pages.length - 1);
    }
  }

  /** Close all pages except the active one. */
  async closeOtherPages(): Promise<void> {
    const active = this.activePage();
    const toClose = this._pages.filter(p => p !== active && !p.isClosed());
    await Promise.all(toClose.map(p => p.close()));
    this._pages = [active];
    this._activeIndex = 0;
  }

  // ── Evaluation ─────────────────────────────────────────────────────────

  /** Evaluate JS on the active page. */
  async evaluate<T = unknown>(fn: string | (() => T)): Promise<T> {
    const page = this.activePage();
    this.lastUsed = new Date();
    return this._eval(page, fn);
  }

  /** Evaluate JS on a specific page by index. */
  async evaluateOn<T = unknown>(fn: string | (() => T), pageIndex: number): Promise<T> {
    const page = this.getPage(pageIndex);
    if (!page) throw new Error(`No page at index ${pageIndex} — pages: ${this._pages.length}`);
    this.lastUsed = new Date();
    return this._eval(page, fn);
  }

  /** Shared eval logic: handles Function, arrow-string, and plain expression. */
  private async _eval<T>(page: Page, fn: string | (() => T)): Promise<T> {
    let fnStr: string;
    if (typeof fn === 'function') {
      fnStr = `(${fn.toString()})()`;
    } else if (/=>/.test(fn)) {
      // Arrow function string like `() => 42` or `(x) => x + 1`
      fnStr = `(${fn})()`;
    } else {
      // Plain expression
      fnStr = fn;
    }
    // eslint-disable-next-line no-new-func
    return page.evaluate(new Function(`return (${fnStr})`) as () => T) as Promise<T>;
  }

  /** Run JS before document loads on active page. */
  async evaluateOnDocument<T = unknown>(fn: string | (() => T)): Promise<T> {
    const page = this.activePage();
    this.lastUsed = new Date();
    const fnStr = typeof fn === 'function' ? `(${fn.toString()})()` : fn;
    // @ts-expect-error CDP binding
    return page.evaluateOnNewDocument(fnStr) as Promise<T>;
  }

  // ── Interaction ─────────────────────────────────────────────────────────

  async click(selector: string, options?: { timeout?: number; button?: 'left' | 'right' }): Promise<void> {
    const page = this.activePage();
    this.lastUsed = new Date();
    await page.click(selector, { timeout: options?.timeout ?? 10_000, button: options?.button ?? 'left' });
  }

  async fill(selector: string, value: string): Promise<void> {
    const page = this.activePage();
    this.lastUsed = new Date();
    await page.fill(selector, value);
  }

  async type(selector: string, text: string, options?: { delay?: number }): Promise<void> {
    const page = this.activePage();
    this.lastUsed = new Date();
    await page.type(selector, text, options);
  }

  async waitForSelector(selector: string, options?: { timeout?: number; state?: 'visible' | 'hidden' | 'attached' }): Promise<unknown> {
    const page = this.activePage();
    this.lastUsed = new Date();
    return page.waitForSelector(selector, {
      timeout: options?.timeout ?? 10_000,
      state: options?.state ?? 'visible',
    });
  }

  async $(selector: string): Promise<unknown> {
    return this.activePage().$(selector);
  }

  async $$(selector: string): Promise<unknown[]> {
    return this.activePage().$$(selector);
  }

  async getContent(): Promise<string> {
    return this.activePage().content();
  }

  async title(): Promise<string> {
    return this.activePage().title();
  }

  // ── Screenshots / PDF ──────────────────────────────────────────────────

  async screenshot(options?: { pageIndex?: number; path?: string; fullPage?: boolean; type?: 'png' | 'jpeg' }): Promise<Buffer> {
    const page = options?.pageIndex !== undefined
      ? this.getPage(options.pageIndex)
      : this.activePage();
    if (!page) throw new Error(`No page at index ${options?.pageIndex ?? this._activeIndex}`);
    this.lastUsed = new Date();
    const { pageIndex: _, ...rest } = options ?? {};
    return page.screenshot({ ...rest }) as Promise<Buffer>;
  }

  async pdf(options?: { path?: string; format?: 'A4' | 'Letter' }): Promise<Buffer> {
    const page = this.activePage();
    this.lastUsed = new Date();
    return page.pdf({ ...options, format: options?.format ?? 'A4' }) as Promise<Buffer>;
  }

  // ── Network ─────────────────────────────────────────────────────────────

  async interceptRequests(_handler: (route: { url: string; abort: () => void; continue: (opts?: { url?: string }) => void }) => void): Promise<void> {
    const page = this.activePage();
    await page.context().route('**/*', async route => route.continue());
  }

  // ── Page Reset (for pool hygiene) ──────────────────────────────────────

  /** Close all pages and reset to blank state.
   *  Called by the pool when a warm session is reused.
   *  Does NOT close the context — context belongs to the pool. */
  async resetPages(): Promise<void> {
    // Close all pages for a fresh start. Context cookies/state belong to this session's lifetime.
    // If true isolation is needed between callers, the pool must allocate a fresh context.
    await Promise.all(
      this._pages.map(p => { try { return p.close(); } catch { return Promise.resolve(); } }),
    );
    this._pages = [];
    this._activeIndex = 0;
  }

  // ── Close ─────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await Promise.all(
      this._pages.map(p => { try { return p.close(); } catch { return Promise.resolve(); } })
    );
    this._pages = [];
    this._activeIndex = 0;
    await this.context.close();
  }
}
