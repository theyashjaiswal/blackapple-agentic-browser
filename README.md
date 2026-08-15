# BlackApple Agentic Browser

> Headless browser for AI agent orchestration — fast, multi-agent-safe, cross-platform.

**BlackApple** wraps Chromium via Playwright (CDP) into a session-pooled API, so multiple AI agents can drive browsers simultaneously without conflicts.

---

## Architecture

```
Agent (Hermes/Claude/GPT)
    ↓ HTTP / WebSocket
API Server (Express + WS)     ←– controls –→ Session Pool
                                                    ↓
                                          BrowserEngine (Playwright/Chromium)
                                                    ↓
                                              Chromium (headless)
```

## Packages

| Package | Description |
|---------|-------------|
| `@blackapple/agentic-browser-core` | `BrowserEngine`, `BrowserSession`, `SessionPool` — the core library |
| `@blackapple/agentic-browser-api` | REST + WebSocket API server (Express, port 3333) |
| `@blackapple/agentic-browser-sdk` | TypeScript SDK — for agents to connect |
| `@blackapple/agentic-browser-cli` | Terminal CLI tool |
| `Dockerfile` | Single-container deploy (Alpine + Node + Chromium) |

## Quick Start

### 1. Install

```bash
git clone https://github.com/theyashjaiswal/blackapple-agentic-browser.git
cd blackapple-agentic-browser
npm install
```

### 2. Start API Server

```bash
cd packages/api && npm run dev
# → Listening on http://localhost:3333
# → WS endpoint: ws://localhost:3333
```

### 3. Use from any agent

**TypeScript SDK:**
```typescript
import { BlackApple } from '@blackapple/agentic-browser-sdk';

const browser = new BlackApple({ baseUrl: 'http://localhost:3333' });

// Acquire session
const { sessionId } = await browser.acquireSession();

// Navigate
await browser.navigate(sessionId, 'https://example.com');

// Release (return to pool)
await browser.releaseSession(sessionId);
```

**REST API:**
```bash
curl http://localhost:3333/health
curl -X POST http://localhost:3333/v1/sessions/acquire
curl -X POST http://localhost:3333/v1/sessions/<id>/release
```

**CLI:**
```bash
npm install -g @blackapple/agentic-browser-cli
blackapple stats
blackapple acquire
blackapple navigate <session-id> https://example.com
```

### 4. Docker

```bash
docker build -t blackapple .
docker run -p 3333:3333 blackapple
```

## Features

- **Session pooling** — max concurrency cap, warm sessions, TTL-based cleanup
- **Full CDP access** — navigate, click, fill, type, evaluate JS, screenshot, PDF, network interception
- **REST + WebSocket** — HTTP for simple commands, WS for streaming/long-running sessions
- **TypeScript SDK** — type-safe client for any agent framework
- **Docker-ready** — single Alpine image, no Playwright browser download needed
- **Cross-platform** — Linux, macOS, Windows

## API Reference

### REST

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check + pool stats |
| `GET` | `/v1/pool/stats` | Current pool stats |
| `POST` | `/v1/sessions/acquire` | Acquire session from pool |
| `POST` | `/v1/sessions/:id/release` | Release session back to pool |

### WebSocket

```json
{ "id": 1, "method": "session.acquire" }
{ "id": 1, "method": "session.release" }
{ "id": 1, "method": "pool.stats" }
```

## Session Pool Config

```typescript
const pool = new SessionPool({
  maxSessions: 10,      // max concurrent sessions
  minSessions: 2,       // warm sessions kept alive
  sessionTTL: 300_000,  // 5 min — sessions auto-close after this
  acquireTimeout: 30_000,
}, { headless: true });
```

## License

MIT
