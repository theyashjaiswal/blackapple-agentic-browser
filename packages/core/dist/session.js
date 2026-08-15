export class BrowserSession {
    context;
    page;
    id;
    createdAt;
    _url = 'about:blank';
    _closed = false;
    constructor(id, context, page) {
        this.context = context;
        this.page = page;
        this.id = id;
        this.createdAt = new Date();
    }
    get url() {
        return this._url;
    }
    get isClosed() {
        return this._closed;
    }
    async navigate(url, options = {}) {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        const { waitUntil = 'domcontentloaded', timeout = 30000 } = options;
        await this.page.goto(url, { waitUntil, timeout });
        this._url = this.page.url();
        return {
            url: this._url,
            title: await this.page.title(),
            content: await this.page.content(),
        };
    }
    async click(selector, options = {}) {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        const { button = 'left', clickCount = 1, timeout = 5000 } = options;
        await this.page.click(selector, { button, clickCount, timeout });
    }
    async fill(selector, value, options = {}) {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        await this.page.fill(selector, value, options);
    }
    async type(selector, text, options = {}) {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        await this.page.type(selector, text, options);
    }
    async evaluate(fn, options = {}) {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        const fnStr = typeof fn === 'function' ? `(${fn.toString()})()` : fn;
        return this.page.evaluate(fnStr);
    }
    async evaluateOnDocument(fn) {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        const fnStr = typeof fn === 'function' ? `(${fn.toString()})()` : fn;
        // @ts-expect-error Playwright page binding
        return this.page.evaluateOnNewDocument(fnStr);
    }
    async screenshot(options = {}) {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        const { fullPage = false, type = 'png', quality } = options;
        return this.page.screenshot({ fullPage, type, quality });
    }
    async waitForSelector(selector, options = {}) {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        const { state = 'visible', timeout = 5000 } = options;
        await this.page.waitForSelector(selector, { state, timeout });
    }
    async waitForTimeout(ms) {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        await this.page.waitForTimeout(ms);
    }
    async getMetrics() {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        return {
            url: this.page.url(),
            title: await this.page.title(),
            content: await this.page.content(),
        };
    }
    async getContent() {
        return this.page.content();
    }
    async title() {
        return this.page.title();
    }
    async $(selector) {
        return this.page.$(selector);
    }
    async $$(selector) {
        return this.page.$$(selector);
    }
    async reload(options = {}) {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        const { waitUntil = 'domcontentloaded', timeout = 30000 } = options;
        await this.page.reload({ waitUntil, timeout });
        this._url = this.page.url();
        return {
            url: this._url,
            title: await this.page.title(),
            content: await this.page.content(),
        };
    }
    async goBack() {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        const navigated = await this.page.goBack();
        if (!navigated)
            return null;
        this._url = this.page.url();
        return {
            url: this._url,
            title: await this.page.title(),
            content: await this.page.content(),
        };
    }
    async goForward() {
        if (this._closed)
            throw new Error(`Session ${this.id} is closed`);
        const navigated = await this.page.goForward();
        if (!navigated)
            return null;
        this._url = this.page.url();
        return {
            url: this._url,
            title: await this.page.title(),
            content: await this.page.content(),
        };
    }
    async close() {
        if (this._closed)
            return;
        this._closed = true;
        await this.context.close();
    }
}
//# sourceMappingURL=session.js.map