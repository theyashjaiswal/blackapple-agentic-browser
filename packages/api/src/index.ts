// BlackApple Agentic Browser — HTTP REST + WebSocket API
// Phase 2: Redis-backed session registry, stateless nodes, backpressure

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { ContextPool, type PoolOptions } from '@blackapple/agentic-browser-core';
import { v4 as uuidv4 } from 'uuid';

// ── Session Registry (Phase 2: Redis, today: in-memory) ───────────────────
// sessionId → { nodeId, contextId }
// TODO(Phase 2): Replace with Redis
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
pool.initialize().then(() => console.log(`[${NODE_ID}] Pool ready`));

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // allow screenshots in body

// Health — includes queue depth for backpressure signal
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

// ── Session Lifecycle ─────────────────────────────────────────────────────────

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
  // TODO: routing — if session belongs to different node, redirect
  // Currently all sessions are local (Phase 2 single-node)
  const registryEntry = sessionRegistry.get(id);
  if (!registryEntry) {
    return res.status(404).json({ error: `Session ${id} not found` });
  }
  if (registryEntry.nodeId !== NODE_ID) {
    return res.status(503).json({ error: 'Session on different node — routing not yet implemented' });
  }

  // Find session in active map — we need to expose active sessions
  // For now, release by id pattern (pool needs releaseById)
  res.status(501).json({ error: 'releaseById not yet exposed on ContextPool' });
});

// Navigate (creates a temp page, navigates, closes page — session stays alive)
app.post('/v1/sessions/:id/navigate', async (req, res) => {
  const { id } = req.params;
  const { url, waitUntil = 'domcontentloaded', timeout = 30_000 } = req.body;

  if (!url) return res.status(400).json({ error: 'url required' });

  // TODO: route to correct node if not local
  const registryEntry = sessionRegistry.get(id);
  if (!registryEntry) return res.status(404).json({ error: 'Session not found' });

  try {
    // We need access to the actual session object to call navigate
    // Currently ContextPool doesn't expose getSession(id)
    // Workaround: re-acquire would conflict. Need to store active sessions.
    res.status(501).json({ error: 'Need active session map — implement in next iteration' });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: e.message });
  }
});

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = createServer(app);
const PORT = parseInt(process.env.PORT || '3333');
server.listen(PORT, () => console.log(`[${NODE_ID}] BlackApple API listening on :${PORT}`));

// ── WebSocket — full session control ────────────────────────────────────────
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
            // We need pool to release by session object, not id
            ws.send(JSON.stringify({ id, result: { released: true } }));
            clientSessionId = null;
          } else {
            ws.send(JSON.stringify({ id, error: 'No session held' }));
          }
          break;
        }

        case 'pool.stats': {
          ws.send(JSON.stringify({ id, result: pool.stats() }));
          break;
        }

        case 'session.navigate': {
          // TODO: needs active session access
          ws.send(JSON.stringify({ id, error: 'Not yet implemented' }));
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
      console.log(`WS closed — session ${clientSessionId} orphaned (pool will reclaim on next cleanup)`);
    }
  });
});
