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
    _pages: Page[];
    _activeIndex: number;
    constructor(id: string, browserId: string, context: BrowserContext, createdAt: Date, lastUsed: Date);
    private activePage;
    private getPage;
    /** Switch to a specific page by index. */
    switchPage(index: number): Promise<void>;
    /** Number of open pages in this session. */
    pageCount(): number;
    /** Create a new page on the session's context. Used by pool health checks. */
    createPage(): Promise<Page | null>;
    /** URLs of all open pages. */
    pageUrls(): string[];
    /** Navigate active page to URL. Creates a page if none exist.
     *  CRITICAL: after closePage(), _pages shrinks but _activeIndex still points to
     *  a valid index. navigate() uses the active page directly, NOT getPage(index).
     *  This correctly handles the "switch then navigate" pattern: switchPage(0) then
     *  navigate('...') always navigates tab 0 even if closePage(1) happened before. */
    navigate(url: string, options?: NavigateOptions): Promise<PageMetrics>;
    /** Create a new blank page/tab. Returns its index. */
    newPage(): Promise<number>;
    /** Open a URL in a new tab. Returns tab index. */
    openTab(url: string, switchTo?: boolean, options?: NavigateOptions): Promise<number>;
    /** Close a specific page by index, or active page if no index provided. */
    closePage(index?: number): Promise<void>;
    /** Close all pages except the active one. */
    closeOtherPages(): Promise<void>;
    /** Evaluate JS on the active page. */
    evaluate<T = unknown>(fn: string | (() => T)): Promise<T>;
    /** Evaluate JS on a specific page by index. */
    evaluateOn<T = unknown>(fn: string | (() => T), pageIndex: number): Promise<T>;
    /** Shared eval logic: handles Function, arrow-string, and plain expression. */
    private _eval;
    /** Run JS before document loads on active page. */
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
    }): Promise<unknown>;
    $(selector: string): Promise<unknown>;
    $$(selector: string): Promise<unknown[]>;
    getContent(): Promise<string>;
    title(): Promise<string>;
    screenshot(options?: {
        pageIndex?: number;
        path?: string;
        fullPage?: boolean;
        type?: 'png' | 'jpeg';
    }): Promise<Buffer>;
    pdf(options?: {
        path?: string;
        format?: 'A4' | 'Letter';
    }): Promise<Buffer>;
    interceptRequests(_handler: (route: {
        url: string;
        abort: () => void;
        continue: (opts?: {
            url?: string;
        }) => void;
    }) => void): Promise<void>;
    /** Close all pages and reset to blank state.
     *  Called by the pool when a warm session is reused.
     *  Does NOT close the context — context belongs to the pool. */
    resetPages(): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=session.d.ts.map