import type { BrowserLaunchOptions, SessionOptions, PoolOptions, PoolStats } from './types.js';
import { BrowserSession } from './session.js';
export declare class BrowserEngine {
    private browser;
    private launched;
    private options;
    constructor(options?: BrowserLaunchOptions);
    launch(): Promise<void>;
    createSession(sessionOptions?: SessionOptions): Promise<BrowserSession>;
    close(): Promise<void>;
    isLaunched(): boolean;
}
export declare class SessionPool {
    private engine;
    private available;
    private active;
    private pending;
    private options;
    private cleanupTimer;
    constructor(options: PoolOptions, engineOptions?: BrowserLaunchOptions);
    initialize(): Promise<void>;
    acquire(): Promise<BrowserSession>;
    release(session: BrowserSession): void;
    private drainPending;
    stats(): PoolStats;
    private startCleanup;
    destroy(): Promise<void>;
}
//# sourceMappingURL=pool.d.ts.map