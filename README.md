# BlackApple Agentic Browser

> Lightweight headless browser for AI agent orchestration. Fast, multi-agent-safe, cross-platform.

**BlackApple** wraps Chromium via Playwright (CDP) into a session-pooled REST API — so Hermes or any AI agent can drive a real Chrome browser without conflicts.

## Features

- **Real Chromium** — full DOM rendering, CSS, JavaScript, network interception
- **Session Pooling** — reuse browser contexts, max concurrency cap
- **Isolated Sessions** — each agent gets its own browser context (cookies, storage separate)
- **REST API** — HTTP endpoints for all browser operations
- **WebSocket** — live session interaction for real-time control
- **Multi-Agent Safe** — pool ensures agents don't steal each other's sessions
- **Cross-Platform** — Linux, macOS, Windows, Docker

## Quick Start

```bash
# Install
npm install @blackapple/agentic-browser-core

# Use
import { BrowserEngine, BrowserSession } from '@blackapple/agentic-browser-core';

const engine = new BrowserEngine({ headless: true });
await engine.launch();

const session = await engine.createSession();
await session.navigate('https://example.com');
await session.click('a[href]');
await session.fill('input[name="q"]', 'search query');
const title = await session.title();
const screenshot = await session.screenshot();

await session.close();
await engine.close();
```

## Architecture

```
AI Agent (Hermes)
    │
    ▼
REST API Server (packages/api)
    │
    ▼
Session Pool (packages/core)
    │
    ▼
Playwright ──► Chromium (CDP)
```

## Packages

| Package | Description |
|---------|-------------|
| `@blackapple/agentic-browser-core` | Browser engine + session pool |
| `@blackapple/agentic-browser-sdk` | TypeScript SDK for agents |
| `@blackapple/agentic-browser-api` | REST + WebSocket API server |
| `@blackapple/agentic-browser-cli` | Terminal interface |

## API Server

```bash
cd packages/api && npm run build && node dist/index.js
# Server running on http://localhost:3000

# Create session
curl -X POST http://localhost:3000/sessions

# Navigate
curl -X POST http://localhost:3000/sessions/{id}/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Screenshot
curl http://localhost:3000/sessions/{id}/screenshot --output screenshot.png

# Close
curl -X DELETE http://localhost:3000/sessions/{id}
```

## Docker

```bash
docker build -t blackapple .
docker run -p 3000:3000 blackapple
```

## Design Principles

- **Session Isolation** — no shared state between agents
- **Connection Reuse** — warm pool of sessions, reset between agents
- **Fail Fast** — typed errors with session context
- **Zero YAGNI** — only what's needed for agentic browsing

## License

MIT
