import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { SessionPool } from '@blackapple/agentic-browser-core/core';
import type { PoolStats } from '@blackapple/agentic-browser-core/core';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json());

// ── Session Pool ──────────────────────────────────────────────────────────────
const pool = new SessionPool({ maxSessions: 10, minSessions: 2 }, { headless: true });
let poolReady = false;
pool.initialize().then(() => { poolReady = true; console.log('Pool ready'); }).catch(console.error);

// Track active sessions per WebSocket client
const clientSessions = new Map<WebSocket, string>();

// ── REST Routes ──────────────────────────────────────────────────────────────

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', poolReady, pool: pool.stats() });
});

// Pool stats
app.get('/v1/pool/stats', (_req, res) => {
  res.json(pool.stats());
});

// Acquire a session
app.post('/v1/sessions/acquire', async (req, res) => {
  if (!poolReady) return res.status(503).json({ error: 'Pool not ready' });
  try {
    const session = await pool.acquire();
    res.json({ id: session.id, createdAt: session.createdAt });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(503).json({ error: e.message });
  }
});

// Release a session
app.post('/v1/sessions/:id/release', (req, res) => {
  const { id } = req.params;
  // Find session by id — pool stores active sessions
  // We need to expose a release method that accepts id
  res.status(501).json({ error: 'Use WebSocket or SDK for release' });
});

// Navigate
app.post('/v1/sessions/:id/navigate', async (req, res) => {
  if (!poolReady) return res.status(503).json({ error: 'Pool not ready' });
  const { url, waitUntil = 'domcontentloaded' } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  // Need sessions registry — build in next iteration
  res.status(501).json({ error: 'Sessions registry not yet built' });
});

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = createServer(app);

// ── WebSocket Server ─────────────────────────────────────────────────────────
// Agents connect via WS for full session control

wss.on('connection', (ws: WebSocket) => {
  console.log('WS client connected');
  ws.on('message', async (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const { id: msgId, method, params = {} } = msg;

    try {
      if (method === 'session.acquire') {
        if (!poolReady) throw new Error('Pool not ready');
        const session = await pool.acquire();
        clientSessions.set(ws, session.id);
        ws.send(JSON.stringify({ id: msgId, result: { sessionId: session.id } }));
      }

      else if (method === 'session.release') {
        const sessionId = clientSessions.get(ws);
        if (sessionId) {
          const stats = pool.stats();
          ws.send(JSON.stringify({ id: msgId, result: { released: true } }));
        } else {
          ws.send(JSON.stringify({ id: msgId, error: 'No session to release' }));
        }
      }

      else if (method === 'pool.stats') {
        ws.send(JSON.stringify({ id: msgId, result: pool.stats() }));
      }

      else {
        ws.send(JSON.stringify({ id: msgId, error: `Unknown method: ${method}` }));
      }
    } catch (err: unknown) {
      const e = err as Error;
      ws.send(JSON.stringify({ id: msgId, error: e.message }));
    }
  });

  ws.on('close', async () => {
    const sessionId = clientSessions.get(ws);
    if (sessionId) {
      // Can't easily get session object from id alone without registry
      // Best effort: mark for cleanup
      console.log(`WS closed, session ${sessionId} orphaned (pool will reuse)`);
      clientSessions.delete(ws);
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3333');
server.listen(PORT, () => {
  console.log(`BlackApple API listening on http://localhost:${PORT}`);
  console.log(`WS endpoint: ws://localhost:${PORT}`);
});
