# BlackApple Agentic Browser

> Headless browser for AI agent orchestration — **context-pooled**, bottleneck-proof, cross-platform.

**BlackApple** wraps Chromium via Playwright (CDP) into a **context-pooled** API. One Chromium process handles 20 isolated contexts (~300MB total). Agents drive browsers without launching new processes per request.

---

## Architecture

```
Hermes Agent(s)
     ↓
BlackApple SDK (retry + backoff)
     ↓
Load Balancer (nginx/traefik) ← Phase 4
     ↓
API Node(s) (stateless)
     ↓
Redis (session registry) ← Phase 2
     ↓
Browser Pool Manager (per node)
     ├── Chromium process 1 → up to 20 contexts
     ├── Chromium process 2 → up to 20 contexts
     └── Browser process N (RAM-capped)
     ↓
Chromium (via Playwright/CDP)
```

## Key Design: Context Pooling

| Model | 20 Sessions RAM | Launch Time |
|-------|----------------|-------------|
| 20 browsers × 1 context | ~3GB | ~20s cold |
| **1 browser × 20 contexts** | **~300MB** | **~200ms** |
| 3 browsers × ~7 contexts | ~500MB | ~1s |

One Chromium, many isolated contexts. This is 10x more memory-efficient than full browser pooling.

## Packages

| Package | Status | Purpose |
|---------|--------|---------|
| `@blackapple/agentic-browser-core` | ✅ Phase 1 | `ContextPool`, `BrowserSession` |
| `@blackapple/agentic-browser-api` | ✅ Phase 1 | REST + WebSocket server |
| `@blackapple/agentic-browser-sdk` | ✅ Phase 1 | TypeScript client |
| `@blackapple/agentic-browser-cli` | ✅ Phase 1 | Terminal CLI |
| `Dockerfile` | ✅ Phase 1 | Alpine + Chromium |
| Redis registry | 🔜 Phase 2 | sessionId → nodeId routing |
| RAM ceilings + watchdog | 🔜 Phase 3 | resource limits |
| Multi-node + LB | 🔜 Phase 4 | horizontal scale |

## Quick Start

```bash
git clone https://github.com/theyashjaiswal/blackapple-agentic-browser.git
cd blackapple-agentic-browser
npm install
cd packages/api && npm run dev
# → Listening on http://localhost:3333
```

## Usage

```typescript
import { BlackApple } from '@blackapple/agentic-browser-sdk';

const browser = new BlackApple({ baseUrl: 'http://localhost:3333' });

// Acquire session (backpressure: waits if pool exhausted)
const { sessionId } = await browser.acquireSession();

// Navigate
const { title, loadTime } = await browser.navigate(sessionId, 'https://example.com');

// Release back to pool (reused by next agent)
await browser.releaseSession(sessionId);
```

## REST API

```
GET  /health                    → { nodeId, queueDepth, stats }
GET  /v1/pool/stats             → { activeContexts, availableContexts, browsers }
POST /v1/sessions/acquire        → { id, browserId, nodeId }
POST /v1/sessions/:id/release    → { released: true }
POST /v1/sessions/:id/navigate  → { url, title, loadTime, status }
```

## Docker

```bash
docker build -t blackapple .
docker run -p 3333:3333 blackapple
```

## Bottleneck Proofing

| Bottleneck | Fix |
|------------|-----|
| Browser-per-request | Context pooling (one Chromium, 20 contexts) |
| Single API node | Stateless nodes + Redis session registry (Phase 2) |
| Unbounded growth | RAM budget auto-calculates max contexts |
| Retry storms | Backpressure: queue-depth signal in 503 responses |
| Crashed browsers | Auto-relaunch on crash (Phase 3) |

## License

MIT
