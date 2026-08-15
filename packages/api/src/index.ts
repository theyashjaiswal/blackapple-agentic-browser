// BlackApple Agentic Browser — HTTP REST + WebSocket API
// Supports multi-tab sessions, persistent page state, auth persistence.

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { ContextPool, BrowserSession, type PoolOptions } from '@blackapple/agentic-browser-core';
import { v4 as uuidv4 } from 'uuid';

// ── Session Registry ─────────────────────────────────────────────────────────
const sessionRegistry = new Map<string, { nodeId: string; browserId: string }>();
const NODE_ID = process.env.NODE_ID || `node-${uuidv4().slice(0, 8)}`;

// ── Context Pool ─────────────────────────────────────────────────────────────
const poolOptions: PoolOptions = {
  maxContexts: parseInt(process.env.MAX_CONTEXTS || '5'),
  maxContextsPerBrowser: 20,
  minWarmContexts: 0,
  idleTimeoutMs: 60_000,
  maxLifetimeMs: 1_800_000,
};
const pool = new ContextPool(poolOptions, { headless: true });
pool.initialize().then(() => console.log(`[${NODE_ID}] Pool ready — ${poolOptions.maxContexts} max contexts`));

// ── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health
app.get('/health', (_req, res) => {
  const stats = pool.stats();
  res.json({ nodeId: NODE_ID, status: 'ok', poolReady: true, queueDepth: stats.pendingAcquires, stats });
});

// Pool stats
app.get('/v1/pool/stats', (_req, res) => res.json(pool.stats()));

// ── Session Lifecycle ───────────────────────────────────────────────────────

// Acquire a session
app.post('/v1/sessions/acquire', async (req, res) => {
  try {
    const session = await pool.acquire();
    sessionRegistry.set(session.id, { nodeId: NODE_ID, browserId: session.browserId });
    res.json({ id: session.id, browserId: session.browserId, nodeId: NODE_ID, createdAt: session.createdAt });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(503).json({ error: e.message, retryAfterMs: 30_000 });
  }
});

// Release a session
app.post('/v1/sessions/:id/release', (req, res) => {
  const { id } = req.params;
  const reg = sessionRegistry.get(id);
  if (!reg) return res.status(404).json({ error: `Session ${id} not found` });
  if (reg.nodeId !== NODE_ID) return res.status(503).json({ error: 'Session on different node' });
  pool.releaseById(id);
  sessionRegistry.delete(id);
  res.json({ released: true });
});

// Get session info
app.get('/v1/sessions/:id', (req, res) => {
  const { id } = req.params;
  const session = pool.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ id: session.id, browserId: session.browserId, nodeId: NODE_ID, createdAt: session.createdAt, pageCount: session.pageCount() });
});

// ── Persistent Page Operations ──────────────────────────────────────────────
// These use the session's persistent page — state (localStorage, cookies) persists.

const withSession = (req: express.Request, res: express.Response, fn: (session: BrowserSession) => Promise<unknown>) => {
  const { id } = req.params;
  const session = pool.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found or released' });
  return fn(session);
};

// Navigate — creates persistent page if none exists
app.post('/v1/sessions/:id/navigate', async (req, res) => {
  const { id } = req.params;
  const session = pool.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { url, waitUntil = 'domcontentloaded', timeout = 30_000 } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const result = await session.navigate(url, { waitUntil, timeout });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Click
app.post('/v1/sessions/:id/click', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { selector, timeout = 10_000, button = 'left' } = req.body;
  if (!selector) return res.status(400).json({ error: 'selector required' });
  try {
    await session.click(selector, { timeout, button });
    res.json({ clicked: selector });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message, selector });
  }
});

// Fill
app.post('/v1/sessions/:id/fill', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { selector, value } = req.body;
  if (!selector || value === undefined) return res.status(400).json({ error: 'selector and value required' });
  try {
    await session.fill(selector, value);
    res.json({ filled: { selector, value } });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message, selector });
  }
});

// Type
app.post('/v1/sessions/:id/type', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { selector, text, delay = 0 } = req.body;
  if (!selector || !text) return res.status(400).json({ error: 'selector and text required' });
  try {
    await session.type(selector, text, { delay });
    res.json({ typed: { selector, textLength: text.length } });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message, selector });
  }
});

// Evaluate JavaScript
app.post('/v1/sessions/:id/evaluate', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { fn, pageIndex } = req.body;
  if (!fn) return res.status(400).json({ error: 'fn (string) required' });
  try {
    const result = pageIndex !== undefined
      ? await session.evaluateOn(fn, pageIndex)
      : await session.evaluate(fn);
    res.json({ result });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Screenshot
app.post('/v1/sessions/:id/screenshot', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { fullPage = false, pageIndex } = req.body;
  try {
    const buffer = await session.screenshot({ fullPage, pageIndex });
    res.json({ screenshot: buffer.toString('base64') });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PDF
app.post('/v1/sessions/:id/pdf', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  try {
    const buffer = await session.pdf();
    res.json({ pdf: buffer.toString('base64') });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get page content
app.get('/v1/sessions/:id/content', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  try {
    const content = await session.getContent();
    res.json({ content });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get title
app.get('/v1/sessions/:id/title', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  try {
    res.json({ title: await session.title() });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Wait for selector
app.post('/v1/sessions/:id/wait-for-selector', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { selector, timeout = 10_000, state = 'visible' } = req.body;
  if (!selector) return res.status(400).json({ error: 'selector required' });
  try {
    await session.waitForSelector(selector, { timeout, state });
    res.json({ found: selector });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Multi-Tab ───────────────────────────────────────────────────────────────

// Open new tab
app.post('/v1/sessions/:id/new-tab', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { url, switchTo = true } = req.body;
  try {
    const tabIndex = url
      ? await session.openTab(url, switchTo)
      : await session.newPage();
    res.json({ tabIndex, pageCount: session.pageCount(), urls: session.pageUrls() });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Switch to tab
app.post('/v1/sessions/:id/switch-tab', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { index } = req.body;
  if (index === undefined) return res.status(400).json({ error: 'index required' });
  try {
    await session.switchPage(index);
    res.json({ activeTab: index, pageCount: session.pageCount(), urls: session.pageUrls() });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Close tab
app.delete('/v1/sessions/:id/tabs/:index', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const index = parseInt(req.params.index);
  try {
    await session.closePage(index);
    res.json({ pageCount: session.pageCount(), urls: session.pageUrls() });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Close other tabs
app.delete('/v1/sessions/:id/tabs', async (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  try {
    await session.closeOtherPages();
    res.json({ pageCount: session.pageCount(), urls: session.pageUrls() });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get all tabs
app.get('/v1/sessions/:id/tabs', (req, res) => {
  const session = pool.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ urls: session.pageUrls(), pageCount: session.pageCount() });
});

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = createServer(app);
const PORT = parseInt(process.env.PORT || '3333');
server.listen(PORT, () => console.log(`[${NODE_ID}] BlackApple API → http://localhost:${PORT}`));

// ── WebSocket ───────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  let clientSessionId: string | null = null;

  ws.on('message', async (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { id, method, params = {} } = msg;

    try {
      switch (method) {

        case 'session.acquire': {
          const session = await pool.acquire();
          sessionRegistry.set(session.id, { nodeId: NODE_ID, browserId: session.browserId });
          clientSessionId = session.id;
          ws.send(JSON.stringify({ id, result: { sessionId: session.id, browserId: session.browserId } }));
          break;
        }

        case 'session.release': {
          if (clientSessionId) {
            pool.releaseById(clientSessionId);
            sessionRegistry.delete(clientSessionId);
            clientSessionId = null;
          }
          ws.send(JSON.stringify({ id, result: { released: true } }));
          break;
        }

        case 'session.navigate': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          const result = await session.navigate(params.url || 'about:blank');
          ws.send(JSON.stringify({ id, result }));
          break;
        }

        case 'session.click': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          await session.click(params.selector);
          ws.send(JSON.stringify({ id, result: { clicked: params.selector } }));
          break;
        }

        case 'session.fill': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          await session.fill(params.selector, params.value);
          ws.send(JSON.stringify({ id, result: { filled: params.selector } }));
          break;
        }

        case 'session.evaluate': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          const result = await session.evaluate(params.fn);
          ws.send(JSON.stringify({ id, result: { result } }));
          break;
        }

        case 'session.screenshot': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          const buf = await session.screenshot({ fullPage: params.fullPage ?? false });
          ws.send(JSON.stringify({ id, result: { screenshot: buf.toString('base64') } }));
          break;
        }

        case 'session.newTab': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          const tabIndex = await session.openTab(params.url, params.switchTo ?? true);
          ws.send(JSON.stringify({ id, result: { tabIndex, urls: session.pageUrls() } }));
          break;
        }

        case 'session.switchTab': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          await session.switchPage(params.index);
          ws.send(JSON.stringify({ id, result: { activeTab: params.index, urls: session.pageUrls() } }));
          break;
        }

        case 'session.closeTab': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          await session.closePage(params.index);
          ws.send(JSON.stringify({ id, result: { urls: session.pageUrls() } }));
          break;
        }

        case 'session.tabs': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          ws.send(JSON.stringify({ id, result: { urls: session.pageUrls(), pageCount: session.pageCount() } }));
          break;
        }

        case 'pool.stats': {
          ws.send(JSON.stringify({ id, result: pool.stats() }));
          break;
        }

        default:
          ws.send(JSON.stringify({ id, error: `Unknown method: ${method}` }));
      }
    } catch (err: unknown) {
      ws.send(JSON.stringify({ id, error: (err as Error).message }));
    }
  });

  ws.on('close', () => {
    if (clientSessionId) {
      console.log(`[WS] Client disconnected — session ${clientSessionId} released`);
      pool.releaseById(clientSessionId);
      sessionRegistry.delete(clientSessionId);
      clientSessionId = null;
    }
  });
});
