// BlackApple Agentic Browser — Core Types
export class BlackAppleError extends Error {
    code;
    sessionId;
    constructor(message, code, sessionId) {
        super(message);
        this.code = code;
        this.sessionId = sessionId;
        this.name = 'BlackAppleError';
    }
}
export class SessionNotFoundError extends BlackAppleError {
    constructor(sessionId) {
        super(`Session '${sessionId}' not found`, 'SESSION_NOT_FOUND', sessionId);
    }
}
export class PoolExhaustedError extends BlackAppleError {
    constructor(max) {
        super(`Session pool exhausted (max=${max})`, 'POOL_EXHAUSTED');
    }
}
export class TimeoutError extends BlackAppleError {
    constructor(operation, ms) {
        super(`${operation} timed out after ${ms}ms`, 'TIMEOUT');
    }
}
//# sourceMappingURL=types.js.map