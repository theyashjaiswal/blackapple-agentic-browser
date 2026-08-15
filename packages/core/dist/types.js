// BlackApple Agentic Browser — Core Types
export class PoolExhaustedError extends Error {
    name = 'PoolExhaustedError';
    message;
    constructor(maxContexts) {
        super(`Pool exhausted: ${maxContexts} contexts in use`);
        this.message = `Pool exhausted: ${maxContexts} contexts in use`;
    }
}
//# sourceMappingURL=types.js.map