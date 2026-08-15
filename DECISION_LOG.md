# BlackApple Agentic Browser — Decision Log

> Every significant decision, pivot, and trade-off made during the project.
> Format: Decision → Alternatives Considered → Reasoning → Outcome

---

## D1 — Browser Engine

**Decision:** Use Playwright (CDP) as the browser control layer, not building from scratch.

**Alternatives considered:**
- Build from scratch (Chromium codebase — 20M+ lines of C++)
- Use webkit (WebKit only — macOS dominant)
- Use jsdom (no real rendering — fake DOM)
- Selenium (slow, legacy, poor CDP support)

**Reasoning:**
A headless browser for AI agents needs real rendering, JavaScript execution, and network control. Only real browsers deliver that. Chromium has the best cross-platform support (Linux, macOS, Windows), and Playwright is the mature, maintained Microsoft library that wraps it via CDP. Building from scratch would be years of work.

**Outcome:** Playwright is the only viable choice. We control Chromium through CDP — we're not modifying Chromium itself.

---

## D2 — Context Pooling vs Browser Pooling (THE CRITICAL PIVOT)

**Decision:** Pool `BrowserContext` objects within a single `Browser` (Chromium process), NOT full browser instances.

**Roadblock hit:** The first `pool.ts` implementation pooled full `Browser` instances. Each `chromium.launch()` created a new OS process (~100MB baseline + ~50MB per context). Running 20 concurrent sessions = 20 browsers = ~3GB RAM + ~20 second cold start.

**Pivot:** After the user's senior review pointed out the architecture was wrong, we researched and confirmed: One Chromium process with 20 contexts = ~300MB total, with ~200ms context creation time. 10x more memory efficient, 100x faster to create contexts.

**Alternatives considered:**
- Full browser pooling (what we built first — wrong)
- Single context, sequential use (no concurrency — wrong)
- One browser per agent (what browser-use/puppeteer libs do by default — expensive)

**Reasoning:**
Chromium's process model: one browser process, many isolated contexts. Each context shares the browser's memory space but has separate cookies/storage. Creating a context costs ~200ms and ~10MB. Creating a browser costs ~3 seconds and ~100MB.

**Outcome:** We rewrote `SessionPool` → `ContextPool`. `BrowserManager` owns ONE Chromium process. `ContextPool` distributes contexts across managers. If one manager reaches 20 contexts, spawn a second manager. RAM budget caps total contexts.

---

## D3 — npm Workspace vs Flat Package Structure

**Decision:** Use flat per-package `package.json` files with `file:` dependencies, NOT npm workspaces.

**Roadblock hit:** npm workspaces with `workspace:*` protocol failed — npm 10.9.8 doesn't support it (requires npm 7+ with specific config). Also, workspaces complicate individual package publishing.

**Alternatives considered:**
- npm workspaces with `workspace:*` (failed — npm protocol not supported)
- pnpm workspaces (would work, adds dependency)
- yarn workspaces (same as pnpm)
- Flat per-package with `file:` paths (simplest, works now)

**Reasoning:**
We need the packages to build independently for publishing to npm later. Workspaces make sense for a monorepo during development, but the `workspace:*` protocol is npm-internal and not portable. Using `file:../core` paths in `package.json` is explicit, works with any package manager, and doesn't require users to use npm workspaces.

**Outcome:** Each package (`core`, `api`, `sdk`, `cli`) has its own `package.json`. Local `file:` dependencies for now. When published to npm, these become proper versioned dependencies.

---

## D4 — Session Pool vs Queue-Based Architecture

**Decision:** Session pool with acquire/release, not a pure job queue.

**Alternatives considered:**
- Job queue (agents submit tasks, workers pick them up — good for batch work)
- Acquire/release session pool (agents hold a session, release when done)
- Stateless request (each request creates/destroys a context — what browser-use does)

**Reasoning:**
AI agents need **interactive browsing** — click, wait, type, observe. This requires stateful sessions. A pure queue is bad because:
1. Agents can't observe intermediate states
2. No streaming screenshots
3. Can't do multi-step user flows

Acquire/release is the right model. The pool manages the lifecycle. When an agent is done, it releases the session back to the pool for reuse.

**Outcome:** Session pool with `acquire()` / `release()`. Pending queue for when pool is exhausted.

---

## D5 — REST + WebSocket API (not just REST)

**Decision:** Both REST (for simple commands) and WebSocket (for streaming/interactive sessions).

**Reasoning:**
Simple agent commands (acquire, release, navigate) fit REST perfectly. But interactive use cases need WebSocket:
- Stream screenshots in real-time
- Handle long-running page interactions
- Bidirectional command/response without polling
- Browser events pushed to agents

**Alternatives considered:**
- REST only (simple but can't handle streaming/interactive)
- WebSocket only (overkill for simple commands)
- GraphQL (adds complexity without clear benefit)

**Outcome:** REST for session lifecycle (acquire, release, stats). WebSocket for session interaction (evaluate, intercept, stream).

---

## D6 — TypeScript Strict Mode

**Decision:** TypeScript with strict mode enabled from day one.

**Reasoning:**
This is a library used by AI agents and developers. Type errors at runtime in a browser pool would be catastrophic. Strict mode catches: implicit any, null pointer access, unused variables, etc.

**Outcome:** `tsconfig.json` has `"strict": true`. Every file passes `tsc --noEmit` before commit.

---

## D7 — Context Isolation Model

**Decision:** Each session gets its own BrowserContext, NOT a shared page within a shared context.

**Reasoning:**
BrowserContext provides:
- Isolated cookies/storage per session
- Isolated browser state
- Independent navigation history
- Can set different user agents per context

This matters for AI agents because each agent session needs its own authentication state, cookies, and browsing history.

**Outcome:** `BrowserSession` wraps a dedicated `BrowserContext`. Every acquire() = one fresh isolated context.

---

## D8 — Backpressure: Queue with Timeout

**Decision:** When pool is exhausted, incoming requests join a pending queue (not rejected), with a 30-second timeout.

**Reasoning:**
If an agent tries to acquire and the pool is full, an immediate 503 rejection causes the agent to retry aggressively — hammering the API. A queue with timeout means:
- Agent waits (backpressure — agent slows down naturally)
- If queue times out, THEN error
- Queue is fair (FIFO)

**Alternatives considered:**
- Immediate rejection (503) — causes retry storms
- Infinite queue — memory leak risk
- Weighted queue — adds complexity

**Outcome:** Pending queue, 30-second timeout per acquire attempt. When a session is released, the oldest pending request gets it first.

---

## D9 — Cleanup: Idle Timeout + Max Lifetime

**Decision:** Two cleanup strategies run on a 30-second interval:
1. **Idle eviction**: Contexts sitting in the warm pool unused for > 60 seconds
2. **Lifetime eviction**: Oldest warm contexts evicted when pool exceeds minimum warm size

**Reasoning:**
Agents may acquire a session, navigate to a page, then disappear (crash, timeout, forgot to release). Without cleanup:
- Leaked sessions accumulate
- Pool gradually starves

We can't just kill active sessions (agent might be using them). But warm (available) sessions are safe to evict. Lifetime eviction prevents warm pools from growing unbounded when minWarm is set high.

**Outcome:** `startCleanup()` interval runs every 30 seconds. Filters available sessions by idle time and max lifetime.

---

## D10 — Memory Budget (RAM-Capped Context Allocation)

**Decision:** Pool respects a `ramBudgetMB` option that auto-calculates max contexts.

**Reasoning:**
On a 16GB server, we can't just set `maxContexts = 10000`. The system would OOM. The pool should respect actual hardware:
- Chromium baseline: ~100MB per process
- Each context: ~10MB
- Formula: `maxContexts = floor((ramBudgetMB - 2GB) / 10MB)`

**Alternatives considered:**
- Fixed maxContexts (requires user to calculate — error-prone)
- No limit (OOM risk)
- Cgroup/memory monitoring (adds complexity, OS-specific)

**Outcome:** `ramBudgetMB` option. If set, `maxContexts` is auto-derived. If not set, `maxContexts` is used as-is.

---

## D11 — Docker: Alpine + System Chromium

**Decision:** Dockerfile uses Alpine + system-installed Chromium, NOT Playwright's bundled Chromium.

**Reasoning:**
Playwright's bundled Chromium (~150MB) downloads per install. Using the system Chromium (already in the Docker image via `apk add chromium`) saves ~150MB per image. The Alpine Chromium is the same engine — we're not gaining anything by downloading Playwright's version.

**Alternatives considered:**
- Playwright bundled Chromium (larger image, slower first install)
- Chrome stable from Google repo (larger, more update overhead)
- Firefox (different engine — our CDP approach is Chromium-specific)

**Outcome:** `apk add chromium` in Alpine. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` env var. Chromium binary at `/usr/bin/chromium-browser`.

---

## D12 — SDK Retry + Backoff (Planned for Phase 5)

**Decision:** SDK will implement exponential backoff with jitter on retry.

**Reasoning:**
When the pool is saturated, agents should:
1. Retry immediately once (most likely a concurrent release)
2. If still fails, back off exponentially: 100ms, 200ms, 400ms, 800ms...
3. Add jitter (±20%) to prevent thundering herd
4. Max 5 retries before surfacing error to agent

**Alternatives considered:**
- No retry (agents see 503 immediately — aggressive, poor UX)
- Fixed delay retry (predictable but causes sync waves)
- Linear backoff (slower to recover than exponential)

**Outcome:** SDK implements `retryWithBackoff(fn, { maxRetries: 5, baseDelay: 100 })`.

---

## D13 — Structured Error Responses (Planned for Phase 5)

**Decision:** When a session operation fails, the error response includes: selector attempted, page URL, console errors, and screenshot.

**Reasoning:**
When Hermes tries to "click the login button" and it fails because the button has a different selector, Hermes needs to diagnose programmatically — not parse a stack trace. Structured errors with embedded context enable:
- Self-healing: Hermes detects selector changed, tries alternatives
- Self-reporting: Error includes screenshot, Hermes knows what went wrong
- Debugging: Console logs from the page reveal JS errors

**Alternatives considered:**
- Stack trace only (human-readable, not machine-readable)
- HTTP status codes (too coarse — "503" could mean 10 different things)

**Outcome:** Error response shape:
```json
{
  "error": "SelectorNotFoundError",
  "selector": "#login-button",
  "url": "https://amazon.com/signin",
  "consoleErrors": ["Refused to load script..."],
  "screenshot": "base64..."
}
```

---

## D14 — Small Model for Testing Loop (Planned for Phase 5)

**Decision:** Use qwen2.5-coder:7b (via Ollama) for repetitive testing, reserve Sonnet/Opus for hard failures.

**Reasoning:**
The self-test loop runs the same tests repeatedly. Running Sonnet/Opus for every test run = $0.50-$3.00 per run. Running qwen2.5-coder locally = $0.00 per run. For the majority of cases where the test surface is known and the fix is routine (selector changed, text updated), a smaller local model is sufficient.

**Alternatives considered:**
- Sonnet/Opus for everything (expensive for volume testing)
- Claude Code CLI (good but requires API access, per-run cost)
- Manual testing (can't scale)

**Outcome:** Hermes's test loop uses local Ollama model by default. On hard failure (model can't determine fix), escalate to hosted model with full context.

---

## D15 — GitHub Repo Creation (Roadblock)

**Decision:** Used `git remote add origin` approach instead of GitHub Desktop automation.

**Roadblock:** GitHub Desktop has its own credential storage that doesn't expose tokens to CLI tools. `gh` CLI was not authenticated. GitHub Desktop uses macOS Keychain directly — token can't be extracted programmatically without the user's Keychain password.

**Alternatives considered:**
- GitHub Desktop AppleScript automation (TCC permissions block UI scripting reliably)
- Token extraction from Keychain (requires user password — security barrier)
- Direct GitHub API with token (no token available)

**Outcome:** Code committed locally. User creates the GitHub repo manually (30 seconds on github.com/new). `git remote add origin` + `git push` is ready to run once the repo exists.

---

## D16 — Package Naming Scope

**Decision:** Scoped as `@blackapple/agentic-browser-*` (not `blackapple-*`).

**Reasoning:**
`@blackapple` org scope on npm means all our packages are grouped together. Someone installing `@blackapple/agentic-browser-sdk` immediately knows it's part of the BlackApple system. It also prevents namespace collision if others publish `blackapple-sdk`.

**Alternatives considered:**
- `blackapple-agentic-browser-*` (unscoped — possible collision)
- `@blackapple/browser-*` (too generic)

**Outcome:** Full `@blackapple/agentic-browser-core`, `@blackapple/agentic-browser-api`, etc.

---

## D17 — Ping/pong vs persistent connections

**Decision:** WebSocket connections are persistent, not ping/pong heartbeat-based.

**Reasoning:**
If a WebSocket client disconnects (agent crash), we need to reclaim the session. We detect this via WS `close` event. No heartbeat needed — if the socket closes, we handle cleanup.

**Outcome:** `wss.on('connection')` tracks `clientSessions`. On `ws.on('close')`, we attempt to release the associated session back to the pool.

---

## Summary: Key Pivot from Initial Build

| What we built first | What we should have built | Why it matters |
|---------------------|---------------------------|----------------|
| `SessionPool` pooling full `Browser` instances | `ContextPool` pooling `BrowserContext` within one `Browser` | 10x RAM savings, 100x faster context creation |
| `BrowserSession` wrapping full browser + page | `BrowserSession` wrapping just `BrowserContext` | Lightweight, one session = one isolated context |
| npm workspaces with `workspace:*` | Flat `file:` dependencies | Works today, no npm version constraint |
| Demo-ready architecture | Production bottleneck-proof architecture | The user's senior review was correct |

---

*Last updated: Phase 1 completion, August 15 2026*

---

## D19 — Persistent Page Per Session

**Decision:** Each `BrowserSession` keeps ONE persistent `Page` for its lifetime, not a fresh page per operation.

**Reasoning:** Real browser automation workflows need login state, cookies, localStorage persisting across navigation. Agents don't close and reopen sessions for every action.

**Alternatives:** Fresh page per operation (isolated, crash-proof, but destroys auth state on every call).

**Outcome:** `BrowserSession` holds one persistent `_page`. When released back to warm pool, `close()` destroys the old page so next caller gets fresh context.

---

## D20 — Pool Release Destroys the Page

**Decision:** When `BrowserSession` is released back to warm pool, its page is closed immediately.

**Reasoning:** A warm session could have residual state (any URL, localStorage, cookies). New caller expects clean slate on `navigate()`.

**Outcome:** `acquire()` from warm → `session.close()` → destroy old page → return context. Page created lazily on first use.

---

## D21 — Tests Use Real HTTP URLs

**Decision:** Session tests use `https://example.com` (real server) for navigation, not `data:` URLs.

**Reasoning:** `data:` URLs have security restrictions. Real-world agents navigate to real HTTPS sites. `localStorage` and auth cookies only work on real HTTP origins.

**Outcome:** Navigate/click tests use `https://example.com`. PDF/screenshot tests use `data:` URLs where needed.

