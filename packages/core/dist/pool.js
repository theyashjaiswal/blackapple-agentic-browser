// BlackApple Agentic Browser — Phase 1: Context Pooling
//
// CRITICAL ARCHITECTURE: We pool BrowserContext, NOT full browsers.
// One Chromium process + 20 contexts = ~300MB
// 20 browsers × 1 context = ~3GB
// Context pooling is 10x more memory efficient.
import { randomUUID } from 'crypto';
import { chromium } from 'playwright';
// ── BrowserManager ────────────────────────────────────────────────────────────
// Owns ONE Chromium process and manages contexts within it.
class BrowserManager {
    options;
    id = randomUUID();
    browser = null;
    contexts = new Set();
    maxContexts;
    constructor(options, maxContextsPerBrowser) {
        this.options = options;
        this.maxContexts = maxContextsPerBrowser;
    }
    async launch() {
        if (this.browser)
            return;
        this.browser = await chromium.launch({
            headless: this.options.headless ?? true,
            args: this.options.args ?? [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
            ],
        });
    }
    async createContext(opts = {}) {
        if (!this.browser)
            await this.launch();
        const ctx = await this.browser.newContext({
            viewport: opts.viewport ?? { width: 1280, height: 720 },
            userAgent: opts.userAgent ?? 'BlackApple/1.0 (+https://github.com/theyashjaiswal/blackapple-agentic-browser)',
            javaScriptEnabled: opts.javaScriptEnabled ?? true,
            ignoreHTTPSErrors: opts.ignoreHTTPSErrors ?? false,
        });
        this.contexts.add(ctx);
        return ctx;
    }
    async closeContext(ctx) {
        try {
            await ctx.close();
        }
        catch { /* ignore */ }
        this.contexts.delete(ctx);
    }
    get activeCount() {
        return this.contexts.size;
    }
    get hasCapacity() {
        return this.contexts.size < this.maxContexts;
    }
    async close() {
        await this.browser?.close();
        this.browser = null;
        this.contexts.clear();
    }
}
// ── Session ───────────────────────────────────────────────────────────────────
class BrowserSession {
    context;
    id;
    createdAt;
    browserId;
    lastUsed;
    constructor(context, browserId) {
        this.context = context;
        this.id = randomUUID();
        this.createdAt = new Date();
        this.browserId = browserId;
        this.lastUsed = new Date();
    }
    async close() {
        await this.context.close();
    }
}
// ── ContextPool ────────────────────────────────────────────────────────────────
// Manages one or more BrowserManagers, distributes contexts across them.
// This is the CORE class — it pools CONTEXTS, not browsers.
export class ContextPool {
    browserOptions;
    managers = [];
    available = [];
    active = new Map(); // sessionId → session
    pending = [];
    maxContexts;
    maxPerBrowser;
    minWarm;
    idleTimeout;
    maxLifetime;
    cleanupTimer = null;
    constructor(poolOptions, browserOptions = {}) {
        this.browserOptions = browserOptions;
        this.maxContexts = poolOptions.maxContexts;
        this.maxPerBrowser = poolOptions.maxContextsPerBrowser ?? 20;
        this.minWarm = poolOptions.minWarmContexts ?? Math.min(2, this.maxContexts);
        this.idleTimeout = poolOptions.idleTimeoutMs ?? 60_000; // 1 min default
        this.maxLifetime = poolOptions.maxLifetimeMs ?? 1_800_000; // 30 min default
    }
    // ── Lifecycle ────────────────────────────────────────────────────────────────
    async initialize() {
        // Pre-warm with minWarm contexts spread across managers
        await this.ensureCapacity(this.minWarm);
        this.startCleanup();
    }
    async destroy() {
        if (this.cleanupTimer)
            clearInterval(this.cleanupTimer);
        await Promise.allSettled([
            ...this.available.map(s => s.close()),
            ...Array.from(this.active.values()).map(s => s.close()),
            ...this.managers.map(m => m.close()),
        ]);
        this.available = [];
        this.active.clear();
        this.managers = [];
        this.pending = [];
    }
    // ── Acquire / Release ─────────────────────────────────────────────────────
    async acquire(opts = {}) {
        // 1. Warm session available
        const warm = this.available.pop();
        if (warm) {
            warm.lastUsed = new Date();
            this.active.set(warm.id, warm);
            return warm;
        }
        // 2. Under max — create new
        if (this.active.size + this.available.length < this.maxContexts) {
            const session = await this.createSession(opts);
            this.active.set(session.id, session);
            return session;
        }
        // 3. At capacity — queue
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.pending.findIndex(p => p.resolve === resolve);
                if (idx !== -1)
                    this.pending.splice(idx, 1);
                reject(new Error(`Pool exhausted: ${this.maxContexts} contexts in use`));
            }, 30_000);
            this.pending.push({ resolve, reject, createdAt: Date.now() });
        });
    }
    release(session) {
        this.releaseById(session.id);
    }
    releaseById(sessionId) {
        const session = this.active.get(sessionId);
        if (!session)
            return;
        this.active.delete(sessionId);
        // If pool is oversized, close instead of return to warm
        const total = this.active.size + this.available.length;
        if (total > this.maxContexts) {
            session.close().catch(() => { });
            return;
        }
        session.lastUsed = new Date();
        this.available.push(session);
        this.drainPending();
    }
    getSession(sessionId) {
        return this.active.get(sessionId);
    }
    async createSession(opts) {
        const manager = this.selectManager();
        const context = await manager.createContext(opts);
        return new BrowserSession(context, manager.id);
    }
    // ── Manager Selection ──────────────────────────────────────────────────────
    selectManager() {
        // Pick manager with most capacity (least loaded)
        const withCapacity = this.managers.filter(m => m.hasCapacity);
        if (withCapacity.length > 0) {
            withCapacity.sort((a, b) => a.activeCount - b.activeCount);
            return withCapacity[0];
        }
        // All full — create new manager if under global max
        const totalContexts = this.managers.reduce((sum, m) => sum + m.activeCount, 0);
        if (totalContexts < this.maxContexts) {
            const mgr = new BrowserManager(this.browserOptions, this.maxPerBrowser);
            this.managers.push(mgr);
            return mgr;
        }
        // Truly at capacity — return least-loaded (will queue)
        this.managers.sort((a, b) => a.activeCount - b.activeCount);
        return this.managers[0];
    }
    ensureCapacity(count) {
        return Promise.all(Array.from({ length: count }, () => this.createSession({}).then(s => this.available.push(s)))).then(() => { });
    }
    // ── Pending Queue Drain ─────────────────────────────────────────────────────
    drainPending() {
        while (this.pending.length > 0 && this.available.length > 0) {
            const p = this.pending.shift();
            const session = this.available.pop();
            session.lastUsed = new Date();
            this.active.set(session.id, session);
            p.resolve(session);
        }
    }
    // ── Cleanup ────────────────────────────────────────────────────────────────
    startCleanup() {
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            // Evict idle sessions over timeout
            const idleEvict = this.available.filter(s => now - s.lastUsed.getTime() > this.idleTimeout);
            for (const s of idleEvict) {
                s.close().catch(() => { });
                this.available = this.available.filter(x => x.id !== s.id);
            }
            // Evict oldest sessions over lifetime
            const total = this.active.size + this.available.length;
            if (total <= this.minWarm)
                return;
            const excess = total - this.minWarm;
            const byAge = [...this.available].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            const toRemove = byAge.slice(0, excess);
            for (const s of toRemove) {
                s.close().catch(() => { });
                this.available = this.available.filter(x => x.id !== s.id);
            }
        }, 30_000);
    }
    // ── Stats ───────────────────────────────────────────────────────────────────
    stats() {
        return {
            totalContexts: this.maxContexts,
            activeContexts: this.active.size,
            availableContexts: this.available.length,
            pendingAcquires: this.pending.length,
            browsers: this.managers.length,
            maxContexts: this.maxContexts,
        };
    }
}
// Alias for backwards compat
export { ContextPool as SessionPool };
//# sourceMappingURL=pool.js.map