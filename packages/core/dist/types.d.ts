export interface BrowserLaunchOptions {
    headless?: boolean;
    args?: string[];
    userAgent?: string;
    timeout?: number;
}
export interface SessionOptions {
    viewport?: {
        width: number;
        height: number;
    };
    userAgent?: string;
    javaScriptEnabled?: boolean;
    ignoreHTTPSErrors?: boolean;
}
export interface PageMetrics {
    url: string;
    title: string;
    content: string;
    screenshot?: Buffer;
}
export interface NavigateOptions {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
    timeout?: number;
}
export interface ClickOptions {
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    timeout?: number;
}
export interface TypeOptions {
    delay?: number;
    timeout?: number;
}
export interface EvaluateOptions {
    timeout?: number;
}
export interface SessionInfo {
    id: string;
    createdAt: Date;
    url: string;
    isActive: boolean;
}
export interface PoolStats {
    active: number;
    available: number;
    pending: number;
    total: number;
}
export interface PoolOptions {
    maxSessions: number;
    minSessions?: number;
    sessionTTL?: number;
    acquireTimeout?: number;
}
export declare class BlackAppleError extends Error {
    code: string;
    sessionId?: string | undefined;
    constructor(message: string, code: string, sessionId?: string | undefined);
}
export declare class SessionNotFoundError extends BlackAppleError {
    constructor(sessionId: string);
}
export declare class PoolExhaustedError extends BlackAppleError {
    constructor(max: number);
}
export declare class TimeoutError extends BlackAppleError {
    constructor(operation: string, ms: number);
}
//# sourceMappingURL=types.d.ts.map