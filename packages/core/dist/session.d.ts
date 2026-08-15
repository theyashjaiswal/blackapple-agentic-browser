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
export declare class BrowserSession {
    readonly id: string;
    readonly browserId: string;
    readonly context: BrowserContext;
    readonly createdAt: Date;
    lastUsed: Date;
    constructor(id: string, browserId: string, context: BrowserContext, createdAt: Date, lastUsed: Date);
    navigate(url: string, options?: NavigateOptions): Promise<PageMetrics>;
    evaluate<T = unknown>(fn: string | (() => T)): Promise<T>;
    evaluateOnDocument<T = unknown>(fn: string | (() => T)): Promise<T>;
    click(selector: string, options?: {
        timeout?: number;
        button?: 'left' | 'right';
    }): Promise<void>;
    fill(selector: string, value: string): Promise<void>;
    type(selector: string, text: string, options?: {
        delay?: number;
    }): Promise<void>;
    waitForSelector(selector: string, options?: {
        timeout?: number;
        state?: 'visible' | 'hidden' | 'attached';
    }): Promise<void>;
    $(selector: string): Promise<ReturnType<Page['$']>>;
    $$(selector: string): Promise<ReturnType<Page['$$']>>;
    getContent(): Promise<string>;
    title(): Promise<string>;
    screenshot(options?: {
        path?: string;
        fullPage?: boolean;
        type?: 'png' | 'jpeg';
    }): Promise<Buffer>;
    pdf(options?: {
        path?: string;
        format?: 'A4' | 'Letter';
    }): Promise<Buffer>;
    interceptRequests(handler: (route: {
        url: string;
        abort: () => void;
        continue: (opts?: {
            url?: string;
        }) => void;
    }) => void): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=session.d.ts.map