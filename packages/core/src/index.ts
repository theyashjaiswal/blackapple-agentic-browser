// BlackApple Agentic Browser — Public Exports
export { BrowserEngine, SessionPool } from './pool.js';
export { BrowserSession } from './session.js';
export type {
  BrowserLaunchOptions,
  SessionOptions,
  PageMetrics,
  NavigateOptions,
  ClickOptions,
  TypeOptions,
  EvaluateOptions,
  SessionInfo,
  PoolStats,
  PoolOptions,
} from './types.js';
export {
  BlackAppleError,
  SessionNotFoundError,
  PoolExhaustedError,
  TimeoutError,
} from './types.js';
