# BlackApple Agentic Browser — Architecture

> Bottleneck-proof headless browser system for AI agent orchestration.

## Core Principle

**Context pooling, NOT browser pooling.**
- One Chromium process = ~50-100MB baseline
- One BrowserContext = ~10MB additional
- 20 contexts per browser = ~300MB total (vs ~1.5GB for 20 browsers)
- This is the single most important architecture decision.

## Full Stack

```
Hermes Agent(s)
     ↓
BlackApple SDK (retry + backoff + exponential fallback)
     ↓
Load Balancer (nginx/traefik)  ← add only after phases 1-3
     ↓
API Node(s) (stateless, horizontally scalable)
     ↓
Redis (session registry: sessionId → nodeId + contextId)
     ↓
Browser Pool Manager (per node)
     ├── Chromium process 1 → up to 20 contexts
     ├── Chromium process 2 → up to 20 contexts
     └── Browser process N (spawned when pool saturates, RAM-capped)
     ↓
Chromium (via Playwright/CDP)
```

## Bottleneck Fixes

| Bottleneck | Fix |
|------------|-----|
| Browser-per-request | Context pooling — one browser, 20 contexts |
| Single API node | Stateless nodes + Redis session registry |
| Unbounded pool growth | RAM budget (e.g. 16GB node → ~40-50 contexts max) |
| No backpressure | SDK retry-with-backoff + queue-depth signal from API |

## Execution Phases

### Phase 1 — Context Pooling (THIS IS THE FOUNDATION)
- [x] Rewrite SessionPool to pool BrowserContext, not Browser
- [x] One BrowserManager holds 1 Chromium process
- [x] ContextPool manages contexts within that browser
- [x] Test with 20 concurrent sessions locally
- **Deliverable**: Can handle 20 concurrent Hermes sessions on one node

### Phase 2 — Redis Session Registry
- [ ] sessionId → { nodeId, browserId, contextId } mapping
- [ ] Any API node can route to correct node
- [ ] Even single-node setup — build it NOW, retrofit later is painful
- **Deliverable**: Redis-backed session registry, stateless API nodes

### Phase 3 — Resource Ceilings + Health Checks
- [ ] Per-context idle timeout (kill if idle > N seconds)
- [ ] Memory watchdog per Chromium process
- [ ] Auto-relaunch on crash
- [ ] RAM budget enforcement (cap contexts against available memory)
- **Deliverable**: Node survives 100x oversubscribed session requests gracefully

### Phase 4 — Load Balancer + Multi-Node
- [ ] nginx/traefik in front of API nodes
- [ ] Session affinity or stateless routing
- [ ] Health checks on nodes
- **Deliverable**: Horizontal scaling by adding nodes

### Phase 5 — Hermes Integration
- [ ] Structured error responses (selector failed, screenshot, console logs)
- [ ] Hermes self-test loop wired to BlackApple
- [ ] Small model (qwen2.5-coder:7b via Ollama) for repetitive testing
- [ ] Escalate hard failures to Sonnet/Opus
- **Deliverable**: Hermes can test, diagnose, and fix bugs autonomously

## Resource Budget (per node, 16GB RAM)

```
OS + base services:     ~2GB
Chromium baseline:       ~100MB × N browsers
Contexts:               ~10MB × M contexts
API server overhead:     ~200MB
Safety margin:          ~1GB

Example: 3 Chromium processes × 20 contexts each = 60 contexts
= 3 × 100MB + 60 × 10MB + 200MB = ~1.1GB total
→ Can comfortably run 40+ contexts on 16GB node
```

## Context vs Browser Pooling (Why Context Wins)

| Model | 20 Sessions RAM | Launch Time | Stability |
|-------|----------------|-------------|-----------|
| 20 browsers, 1 context each | ~3GB | ~20s cold | Crash any one = lose 5% capacity |
| 1 browser, 20 contexts | ~300MB | ~200ms | Crash = lose 100% |
| 3 browsers, ~7 contexts each | ~500MB | ~1s | Crash 1 = lose 33% |

**Selected: N browsers × 20 contexts max each, where N = floor((RAM - 2GB) / 200MB)**
