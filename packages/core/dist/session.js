// BlackApple Agentic Browser — BrowserSession
// Lightweight wrapper around Playwright BrowserContext with BlackApple-specific helpers.
export class BrowserSession {
    id;
    browserId;
    context;
    createdAt;
    lastUsed;
    constructor(id, browserId, context, createdAt, lastUsed) {
        this.id = id;
        this.browserId = browserId;
        this.context = context;
        this.createdAt = createdAt;
        this.lastUsed = lastUsed;
    }
    // ── Navigation ───────────────────────────────────────────────────────────────
    async navigate(url, options = {}) {
        const { waitUntil = 'domcontentloaded', timeout = 30_000 } = options;
        const start = Date.now();
        const page = await this.context.newPage();
        const response = await page.goto(url, { waitUntil, timeout });
        const metrics = {
            url: page.url(),
            title: await page.title(),
            loadTime: Date.now() - start,
            status: response?.status() ?? 0,
        };
        await page.close();
        return metrics;
    }
    // ── Evaluation ─────────────────────────────────────────────────────────────
    async evaluate(fn) {
        const page = await this.context.newPage();
        try {
            const result = await page.evaluate(typeof fn === 'function' ? fn : new Function(fn));
            return result;
        }
        finally {
            await page.close();
        }
    }
    async evaluateOnDocument(fn) {
        const page = await this.context.newPage();
        try {
            const fnStr = typeof fn === 'function' ? `(${fn.toString()})()` : fn;
            // @ts-expect-error CDP binding
            return await page.evaluateOnNewDocument(fnStr);
        }
        finally {
            await page.close();
        }
    }
    // ── Interaction ────────────────────────────────────────────────────────────
    async click(selector, options) {
        const page = await this.context.newPage();
        try {
            await page.click(selector, { timeout: options?.timeout ?? 10_000, button: options?.button ?? 'left' });
        }
        finally {
            await page.close();
        }
    }
    async fill(selector, value) {
        const page = await this.context.newPage();
        try {
            await page.fill(selector, value);
        }
        finally {
            await page.close();
        }
    }
    async type(selector, text, options) {
        const page = await this.context.newPage();
        try {
            await page.type(selector, text, options);
        }
        finally {
            await page.close();
        }
    }
    async waitForSelector(selector, options) {
        const page = await this.context.newPage();
        try {
            await page.waitForSelector(selector, { timeout: options?.timeout ?? 10_000, state: options?.state ?? 'visible' });
        }
        finally {
            await page.close();
        }
    }
    async $(selector) {
        const page = await this.context.newPage();
        try {
            return await page.$(selector);
        }
        finally {
            await page.close();
        }
    }
    async $$(selector) {
        const page = await this.context.newPage();
        try {
            return await page.$$(selector);
        }
        finally {
            await page.close();
        }
    }
    async getContent() {
        const page = await this.context.newPage();
        try {
            return page.content();
        }
        finally {
            await page.close();
        }
    }
    async title() {
        const page = await this.context.newPage();
        try {
            return page.title();
        }
        finally {
            await page.close();
        }
    }
    // ── Screenshots / PDF ─────────────────────────────────────────────────────
    async screenshot(options) {
        const page = await this.context.newPage();
        try {
            return await page.screenshot({ ...options });
        }
        finally {
            await page.close();
        }
    }
    async pdf(options) {
        const page = await this.context.newPage();
        try {
            return await page.pdf({ ...options, format: options?.format ?? 'A4' });
        }
        finally {
            await page.close();
        }
    }
    // ── Network Interception ───────────────────────────────────────────────────
    async interceptRequests(handler) {
        await this.context.route('**/*', async (route) => {
            const req = route.request();
            try {
                if (handler.length >= 3) {
                    // old API compat
                    await route.continue();
                }
                else {
                    await route.continue();
                }
            }
            catch {
                await route.abort();
            }
        });
    }
    async close() {
        await this.context.close();
    }
}
//# sourceMappingURL=session.js.map