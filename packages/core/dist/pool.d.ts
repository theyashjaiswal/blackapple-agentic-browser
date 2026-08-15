import { type BrowserContext } from 'playwright';
import { BrowserSession } from './session.js';
export interface SessionOptions {
    viewport?: {
        width: number;
        height: number;
    };
    userAgent?: string;
    javaScriptEnabled?: boolean;
    ignoreHTTPSErrors?: boolean;
}
export interface PoolOptions {
    /** Max concurrent contexts across ALL browsers */
    maxContexts: number;
    /** Max contexts per single Chromium process */
    maxContextsPerBrowser?: number;
    /** Min warm contexts to keep ready */
    minWarmContexts?: number;
    /** Kill context after N ms of inactivity */
    idleTimeoutMs?: number;
    /** Kill context after N ms since creation */
    maxLifetimeMs?: number;
    /** Kill context if browser process uses > N MB */
    maxContextMemoryMB?: number;
    /** Ram budget per node in MB (auto-calculates maxContexts if not set) */
    ramBudgetMB?: number;
}
export interface Session {
    readonly id: string;
    readonly createdAt: Date;
    context: BrowserContext;
    browserId: string;
    lastUsed: Date;
    close(): Promise<void>;
}
export interface PoolStats {
    totalContexts: number;
    activeContexts: number;
    availableContexts: number;
    pendingAcquires: number;
    browsers: number;
    maxContexts: number;
    memoryUsageMB?: number;
}
declare class PooledSession extends BrowserSession {
    constructor(context: BrowserContext, browserId: string);
    close(): Promise<void>;
}
export declare class ContextPool {
    private browserOptions;
    private managers;
    private available;
    private active;
    private pending;
    private readonly maxContexts;
    private readonly maxPerBrowser;
    private readonly minWarm;
    private readonly idleTimeout;
    private readonly maxLifetime;
    private cleanupTimer;
    constructor(poolOptions: PoolOptions, browserOptions?: {
        headless?: boolean;
        args?: string[];
        userAgent?: string;
    });
    initialize(): Promise<void>;
    destroy(): Promise<void>;
    acquire(opts?: SessionOptions): Promise<PooledSession>;
    release(session: PooledSession): void;
    releaseById(sessionId: string): void;
    getSession(sessionId: string): PooledSession | undefined;
    private createSession;
    private selectManager;
    private ensureCapacity;
    private drainPending;
    private startCleanup;
    stats(): PoolStats;
}
export { ContextPool as SessionPool };
//# sourceMappingURL=pool.d.ts.map