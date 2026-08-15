// BlackApple Agentic Browser — Browser Session
import type { Page, BrowserContext } from 'playwright';
import type { SessionOptions, PageMetrics, NavigateOptions } from './types.js';

export class BrowserSession {
  readonly id: string;
  readonly createdAt: Date;
  private _url: string = 'about:blank';
  private _closed: boolean = false;

  constructor(
    id: string,
    private context: BrowserContext,
    private page: Page
  ) {
    this.id = id;
    this.createdAt = new Date();
  }

  get url(): string {
    return this._url;
  }

  get isClosed(): boolean {
    return this._closed;
  }

  async navigate(url: string, options: NavigateOptions = {}): Promise<PageMetrics> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);

    const { waitUntil = 'domcontentloaded', timeout = 30000 } = options;
    await this.page.goto(url, { waitUntil, timeout });
    this._url = this.page.url();

    return {
      url: this._url,
      title: await this.page.title(),
      content: await this.page.content(),
    };
  }

  async click(selector: string, options: { button?: 'left' | 'right' | 'middle'; clickCount?: number; timeout?: number } = {}): Promise<void> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    const { button = 'left', clickCount = 1, timeout = 5000 } = options;
    await this.page.click(selector, { button, clickCount, timeout });
  }

  async fill(selector: string, value: string, options: { timeout?: number } = {}): Promise<void> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    await this.page.fill(selector, value, options);
  }

  async type(selector: string, text: string, options: { delay?: number; timeout?: number } = {}): Promise<void> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    await this.page.type(selector, text, options);
  }

  async evaluate<T = unknown>(fn: string | (() => T), options: { timeout?: number } = {}): Promise<T> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    const fnStr = typeof fn === 'function' ? `(${fn.toString()})()` : fn;
    return this.page.evaluate(fnStr) as Promise<T>;
  }

  async evaluateOnDocument<T = unknown>(fn: string | (() => T)): Promise<T> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    const fnStr = typeof fn === 'function' ? `(${fn.toString()})()` : fn;
    // @ts-expect-error Playwright page binding
    return this.page.evaluateOnNewDocument(fnStr) as Promise<T>;
  }

  async screenshot(options: { fullPage?: boolean; type?: 'png' | 'jpeg'; quality?: number } = {}): Promise<Buffer> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    const { fullPage = false, type = 'png', quality } = options;
    return this.page.screenshot({ fullPage, type, quality } as Record<string, unknown>);
  }

  async waitForSelector(selector: string, options: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number } = {}): Promise<void> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    const { state = 'visible', timeout = 5000 } = options;
    await this.page.waitForSelector(selector, { state, timeout });
  }

  async waitForTimeout(ms: number): Promise<void> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    await this.page.waitForTimeout(ms);
  }

  async getMetrics(): Promise<PageMetrics> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    return {
      url: this.page.url(),
      title: await this.page.title(),
      content: await this.page.content(),
    };
  }

  async getContent(): Promise<string> {
    return this.page.content();
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  async $(selector: string): Promise<ReturnType<Page['$']>> {
    return this.page.$(selector);
  }

  async $$(selector: string): Promise<ReturnType<Page['$$']>> {
    return this.page.$$(selector);
  }

  async reload(options: NavigateOptions = {}): Promise<PageMetrics> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    const { waitUntil = 'domcontentloaded', timeout = 30000 } = options;
    await this.page.reload({ waitUntil, timeout });
    this._url = this.page.url();
    return {
      url: this._url,
      title: await this.page.title(),
      content: await this.page.content(),
    };
  }

  async goBack(): Promise<PageMetrics | null> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    const navigated = await this.page.goBack();
    if (!navigated) return null;
    this._url = this.page.url();
    return {
      url: this._url,
      title: await this.page.title(),
      content: await this.page.content(),
    };
  }

  async goForward(): Promise<PageMetrics | null> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    const navigated = await this.page.goForward();
    if (!navigated) return null;
    this._url = this.page.url();
    return {
      url: this._url,
      title: await this.page.title(),
      content: await this.page.content(),
    };
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    await this.context.close();
  }
}
