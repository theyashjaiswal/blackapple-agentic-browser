// BlackApple Agentic Browser — BrowserSession
// Wraps Playwright BrowserContext with BlackApple API.
// Supports multi-tab: open/close/switch pages within a single session.
// Auth state (cookies, localStorage) persists across pages within the same context.
export class BrowserSession {
    id;
    browserId;
    context;
    createdAt;
    lastUsed;
    _pages = [];
    _activeIndex = 0;
    constructor(id, browserId, context, createdAt, lastUsed) {
        this.id = id;
        this.browserId = browserId;
        this.context = context;
        this.createdAt = createdAt;
        this.lastUsed = lastUsed;
    }
    // ── Page Management ─────────────────────────────────────────────────────
    activePage() {
        const page = this._pages[this._activeIndex];
        if (!page || page.isClosed()) {
            throw new Error('No active page. Call navigate() or newPage() first.');
        }
        return page;
    }
    getPage(index) {
        const page = this._pages[index];
        if (!page || page.isClosed())
            return null;
        return page;
    }
    /** Switch to a specific page by index. */
    async switchPage(index) {
        const page = this.getPage(index);
        if (!page)
            throw new Error(`Page index ${index} is not available`);
        this._activeIndex = index;
        this.lastUsed = new Date();
    }
    /** Number of open pages in this session. */
    pageCount() {
        return this._pages.filter(p => !p.isClosed()).length;
    }
    /** URLs of all open pages. */
    pageUrls() {
        return this._pages.filter(p => !p.isClosed()).map(p => p.url());
    }
    // ── Navigation ─────────────────────────────────────────────────────────
    /** Navigate active page to URL. Creates a page if none exist. */
    async navigate(url, options = {}) {
        const { waitUntil = 'domcontentloaded', timeout = 30_000 } = options;
        const start = Date.now();
        let page = this.getPage(this._activeIndex);
        if (!page) {
            page = await this.context.newPage();
            this._pages.push(page);
            this._activeIndex = this._pages.length - 1;
        }
        const response = await page.goto(url, { waitUntil, timeout });
        this.lastUsed = new Date();
        return {
            url: page.url(),
            title: await page.title(),
            loadTime: Date.now() - start,
            status: response?.status() ?? 0,
        };
    }
    // ── Multi-Tab ──────────────────────────────────────────────────────────
    /** Create a new blank page/tab. Returns its index. */
    async newPage() {
        const page = await this.context.newPage();
        this._pages.push(page);
        this.lastUsed = new Date();
        return this._pages.length - 1;
    }
    /** Open a URL in a new tab. Returns tab index. */
    async openTab(url, switchTo = true, options = {}) {
        const page = await this.context.newPage();
        this._pages.push(page);
        const index = this._pages.length - 1;
        if (switchTo)
            this._activeIndex = index;
        await page.goto(url, {
            waitUntil: options.waitUntil ?? 'domcontentloaded',
            timeout: options.timeout ?? 30_000,
        });
        this.lastUsed = new Date();
        return index;
    }
    /** Close a specific page by index, or active page if no index provided. */
    async closePage(index) {
        const targetIndex = index ?? this._activeIndex;
        const page = this.getPage(targetIndex);
        if (!page)
            return;
        await page.close();
        // Remove from array (not null-mark)
        this._pages.splice(targetIndex, 1);
        // Adjust active index if needed
        if (this._pages.length === 0) {
            this._activeIndex = 0;
        }
        else if (index === undefined || targetIndex <= this._activeIndex) {
            // Closed active or before active — clamp
            this._activeIndex = Math.min(this._activeIndex, this._pages.length - 1);
        }
    }
    /** Close all pages except the active one. */
    async closeOtherPages() {
        const active = this.activePage();
        const activeIdx = this._pages.indexOf(active);
        const toClose = this._pages.filter(p => p !== active && !p.isClosed());
        await Promise.all(toClose.map(p => p.close()));
        this._pages = [active];
        this._activeIndex = 0;
    }
    // ── Evaluation ──────────────────────────────────────────────────────────
    /** Evaluate JS on the active page. */
    async evaluate(fn) {
        const page = this.activePage();
        this.lastUsed = new Date();
        let fnStr;
        if (typeof fn === 'function') {
            // Convert function to body string and call it immediately
            fnStr = `(${fn.toString()})()`;
        }
        else if (fn.includes('=>')) {
            // String contains arrow function — wrap in parens and call
            fnStr = `(${fn})()`;
        }
        else {
            // Plain expression string — return it directly
            fnStr = fn;
        }
        // eslint-disable-next-line no-new-func
        return page.evaluate(new Function(`return (${fnStr})`));
    }
    /** Evaluate JS on a specific page by index. */
    async evaluateOn(fn, pageIndex) {
        const page = this.getPage(pageIndex);
        if (!page)
            throw new Error(`Page index ${pageIndex} is not available`);
        this.lastUsed = new Date();
        let fnStr;
        if (typeof fn === 'function') {
            fnStr = `(${fn.toString()})()`;
        }
        else if (fn.includes('=>')) {
            fnStr = `(${fn})()`;
        }
        else {
            fnStr = fn;
        }
        // eslint-disable-next-line no-new-func
        return page.evaluate(new Function(`return (${fnStr})`));
    }
    /** Run JS before document loads on active page. */
    async evaluateOnDocument(fn) {
        const page = this.activePage();
        this.lastUsed = new Date();
        const fnStr = typeof fn === 'function' ? `(${fn.toString()})()` : fn;
        // @ts-expect-error CDP binding
        return page.evaluateOnNewDocument(fnStr);
    }
    // ── Interaction ──────────────────────────────────────────────────────────
    async click(selector, options) {
        const page = this.activePage();
        this.lastUsed = new Date();
        await page.click(selector, { timeout: options?.timeout ?? 10_000, button: options?.button ?? 'left' });
    }
    async fill(selector, value) {
        const page = this.activePage();
        this.lastUsed = new Date();
        await page.fill(selector, value);
    }
    async type(selector, text, options) {
        const page = this.activePage();
        this.lastUsed = new Date();
        await page.type(selector, text, options);
    }
    async waitForSelector(selector, options) {
        const page = this.activePage();
        this.lastUsed = new Date();
        return page.waitForSelector(selector, {
            timeout: options?.timeout ?? 10_000,
            state: options?.state ?? 'visible',
        });
    }
    async $(selector) {
        return this.activePage().$(selector);
    }
    async $$(selector) {
        return this.activePage().$$(selector);
    }
    async getContent() {
        return this.activePage().content();
    }
    async title() {
        return this.activePage().title();
    }
    // ── Screenshots / PDF ──────────────────────────────────────────────────
    async screenshot(options) {
        const page = options?.pageIndex !== undefined ? this.getPage(options.pageIndex) : this.getPage(this._activeIndex);
        if (!page)
            throw new Error('No such page');
        this.lastUsed = new Date();
        const { pageIndex: _, ...rest } = options ?? {};
        return page.screenshot({ ...rest });
    }
    async pdf(options) {
        const page = this.activePage();
        this.lastUsed = new Date();
        return page.pdf({ ...options, format: options?.format ?? 'A4' });
    }
    // ── Network ─────────────────────────────────────────────────────────────
    async interceptRequests(_handler) {
        const page = this.activePage();
        await page.context().route('**/*', async (route) => route.continue());
    }
    // ── Page Reset (for pool hygiene) ──────────────────────────────────────
    /** Close all pages and reset to blank state.
     *  Called by the pool when a warm session is reused.
     *  Does NOT close the context — context belongs to the pool. */
    async resetPages() {
        await Promise.all(this._pages.map(p => { try {
            return p.close();
        }
        catch {
            return Promise.resolve();
        } }));
        this._pages = [];
        this._activeIndex = 0;
    }
    // ── Close ─────────────────────────────────────────────────────────────
    async close() {
        await Promise.all(this._pages.map(p => { try {
            return p.close();
        }
        catch {
            return Promise.resolve();
        } }));
        this._pages = [];
        this._activeIndex = 0;
        await this.context.close();
    }
}
//# sourceMappingURL=session.js.map