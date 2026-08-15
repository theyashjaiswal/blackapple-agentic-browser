// BlackApple Agentic Browser — HTTP REST + WebSocket API
// Phase 2: Context-pooled, stateless, backpressure-ready

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { ContextPool, BrowserSession, type PoolOptions } from '@blackapple/agentic-browser-core';
import { v4 as uuidv4 } from 'uuid';

// ── Session Registry ──────────────────────────────────────────────────────────
// TODO(Phase 2): Replace with Redis
// sessionId → { nodeId, browserId }
// Allows routing requests to the correct node
const sessionRegistry = new Map<string, { nodeId: string; browserId: string }>();
const NODE_ID = process.env.NODE_ID || `node-${uuidv4().slice(0, 8)}`;

// ── Context Pool ──────────────────────────────────────────────────────────────
const poolOptions: PoolOptions = {
  maxContexts: parseInt(process.env.MAX_CONTEXTS || '20'),
  maxContextsPerBrowser: 20,
  minWarmContexts: 2,
  idleTimeoutMs: 60_000,
  maxLifetimeMs: 1_800_000,
};
const pool = new ContextPool(poolOptions, { headless: true });
pool.initialize().then(() => console.log(`[${NODE_ID}] ContextPool ready — ${poolOptions.maxContexts} max contexts`));

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health — queueDepth signals backpressure to SDK
app.get('/health', (_req, res) => {
  const stats = pool.stats();
  res.json({
    nodeId: NODE_ID,
    status: 'ok',
    poolReady: true,
    queueDepth: stats.pendingAcquires,
    stats,
  });
});

// Pool stats
app.get('/v1/pool/stats', (_req, res) => {
  res.json(pool.stats());
});

// ── Session Lifecycle ────────────────────────────────────────────────────────

// Acquire a session
app.post('/v1/sessions/acquire', async (req, res) => {
  try {
    const session = await pool.acquire();
    sessionRegistry.set(session.id, { nodeId: NODE_ID, browserId: session.browserId });

    res.json({
      id: session.id,
      browserId: session.browserId,
      nodeId: NODE_ID,
      createdAt: session.createdAt,
    });
  } catch (err: unknown) {
    const e = err as Error;
    const stats = pool.stats();
    res.status(503).json({
      error: e.message,
      queueDepth: stats.pendingAcquires,
      retryAfterMs: 30_000,
    });
  }
});

// Release a session
app.post('/v1/sessions/:id/release', (req, res) => {
  const { id } = req.params;
  const registryEntry = sessionRegistry.get(id);

  if (!registryEntry) {
    return res.status(404).json({ error: `Session ${id} not found` });
  }
  if (registryEntry.nodeId !== NODE_ID) {
    // TODO(Phase 2): Proxy to correct node
    return res.status(503).json({ error: 'Session on different node — routing not yet implemented' });
  }

  pool.releaseById(id);
  sessionRegistry.delete(id);
  res.json({ released: true });
});

// ── Session Interaction ───────────────────────────────────────────────────────

// Navigate
app.post('/v1/sessions/:id/navigate', async (req, res) => {
  const { id } = req.params;
  const { url, waitUntil = 'domcontentloaded', timeout = 30_000 } = req.body;

  if (!url) return res.status(400).json({ error: 'url is required' });

  const session = pool.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found or already released' });

  try {
    const page = await session.context.newPage();
    const start = Date.now();
    const response = await page.goto(url, {
      waitUntil: waitUntil as any,
      timeout: Math.min(timeout, 60_000),
    });
    const title = await page.title();
    await page.close();

    res.json({
      url: page.url(),
      title,
      status: response?.status() ?? 0,
      loadTime: Date.now() - start,
    });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: e.message });
  }
});

// Click element
app.post('/v1/sessions/:id/click', async (req, res) => {
  const { id } = req.params;
  const { selector, timeout = 10_000 } = req.body;
  if (!selector) return res.status(400).json({ error: 'selector required' });

  const session = pool.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const page = await session.context.newPage();
    await page.click(selector, { timeout });
    await page.close();
    res.json({ clicked: selector });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: e.message, selector });
  }
});

// Fill input
app.post('/v1/sessions/:id/fill', async (req, res) => {
  const { id } = req.params;
  const { selector, value } = req.body;
  if (!selector || value === undefined) return res.status(400).json({ error: 'selector and value required' });

  const session = pool.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const page = await session.context.newPage();
    await page.fill(selector, value);
    await page.close();
    res.json({ filled: { selector, value } });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: e.message, selector });
  }
});

// Type with optional delay
app.post('/v1/sessions/:id/type', async (req, res) => {
  const { id } = req.params;
  const { selector, text, delay = 0 } = req.body;
  if (!selector || !text) return res.status(400).json({ error: 'selector and text required' });

  const session = pool.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const page = await session.context.newPage();
    await page.locator(selector).pressSequentially(text, { delay });
    await page.close();
    res.json({ typed: { selector, textLength: text.length } });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: e.message, selector });
  }
});

// Evaluate JavaScript
app.post('/v1/sessions/:id/evaluate', async (req, res) => {
  const { id } = req.params;
  const { fn } = req.body;
  if (!fn) return res.status(400).json({ error: 'fn (string) required' });

  const session = pool.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const page = await session.context.newPage();
    // eslint-disable-next-line no-eval
    const result = await page.evaluate(new Function(fn) as () => unknown);
    await page.close();
    res.json({ result });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: e.message });
  }
});

// Screenshot
app.post('/v1/sessions/:id/screenshot', async (req, res) => {
  const { id } = req.params;
  const { fullPage = false, path } = req.body;

  const session = pool.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const page = await session.context.newPage();
    const buffer = await page.screenshot({ fullPage, path } as any);
    await page.close();
    if (path) {
      res.json({ saved: path });
    } else {
      res.json({ screenshot: buffer.toString('base64') });
    }
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: e.message });
  }
});

// Get page content
app.get('/v1/sessions/:id/content', async (req, res) => {
  const { id } = req.params;
  const session = pool.getSession(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const page = await session.context.newPage();
    const content = await page.content();
    await page.close();
    res.json({ content });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: e.message });
  }
});

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = createServer(app);
const PORT = parseInt(process.env.PORT || '3333');
server.listen(PORT, () => console.log(`[${NODE_ID}] BlackApple API → http://localhost:${PORT}`));

// ── WebSocket — bidirectional, streaming ──────────────────────────────────────
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

        case 'pool.stats': {
          ws.send(JSON.stringify({ id, result: pool.stats() }));
          break;
        }

        case 'session.navigate': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          const page = await session.context.newPage();
          const response = await page.goto(params.url || 'about:blank', { waitUntil: params.waitUntil || 'domcontentloaded' });
          ws.send(JSON.stringify({ id, result: { url: page.url(), status: response?.status(), title: await page.title() } }));
          await page.close();
          break;
        }

        case 'session.click': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          const page = await session.context.newPage();
          await page.click(params.selector);
          ws.send(JSON.stringify({ id, result: { clicked: params.selector } }));
          await page.close();
          break;
        }

        case 'session.fill': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          const page = await session.context.newPage();
          await page.fill(params.selector, params.value);
          ws.send(JSON.stringify({ id, result: { filled: params.selector } }));
          await page.close();
          break;
        }

        case 'session.screenshot': {
          const session = clientSessionId ? pool.getSession(clientSessionId) : null;
          if (!session) { ws.send(JSON.stringify({ id, error: 'No active session' })); break; }
          const page = await session.context.newPage();
          const buf = await page.screenshot({ fullPage: params.fullPage ?? false });
          ws.send(JSON.stringify({ id, result: { screenshot: buf.toString('base64') } }));
          await page.close();
          break;
        }

        default:
          ws.send(JSON.stringify({ id, error: `Unknown method: ${method}` }));
      }
    } catch (err: unknown) {
      const e = err as Error;
      ws.send(JSON.stringify({ id, error: e.message }));
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
