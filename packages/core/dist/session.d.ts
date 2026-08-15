import type { Page, BrowserContext } from 'playwright';
import type { PageMetrics, NavigateOptions } from './types.js';
export declare class BrowserSession {
    private context;
    private page;
    readonly id: string;
    readonly createdAt: Date;
    private _url;
    private _closed;
    constructor(id: string, context: BrowserContext, page: Page);
    get url(): string;
    get isClosed(): boolean;
    navigate(url: string, options?: NavigateOptions): Promise<PageMetrics>;
    click(selector: string, options?: {
        button?: 'left' | 'right' | 'middle';
        clickCount?: number;
        timeout?: number;
    }): Promise<void>;
    fill(selector: string, value: string, options?: {
        timeout?: number;
    }): Promise<void>;
    type(selector: string, text: string, options?: {
        delay?: number;
        timeout?: number;
    }): Promise<void>;
    evaluate<T = unknown>(fn: string | (() => T), options?: {
        timeout?: number;
    }): Promise<T>;
    evaluateOnDocument<T = unknown>(fn: string | (() => T)): Promise<T>;
    screenshot(options?: {
        fullPage?: boolean;
        type?: 'png' | 'jpeg';
        quality?: number;
    }): Promise<Buffer>;
    waitForSelector(selector: string, options?: {
        state?: 'attached' | 'detached' | 'visible' | 'hidden';
        timeout?: number;
    }): Promise<void>;
    waitForTimeout(ms: number): Promise<void>;
    getMetrics(): Promise<PageMetrics>;
    getContent(): Promise<string>;
    title(): Promise<string>;
    $(selector: string): Promise<ReturnType<Page['$']>>;
    $$(selector: string): Promise<ReturnType<Page['$$']>>;
    reload(options?: NavigateOptions): Promise<PageMetrics>;
    goBack(): Promise<PageMetrics | null>;
    goForward(): Promise<PageMetrics | null>;
    close(): Promise<void>;
}
//# sourceMappingURL=session.d.ts.map