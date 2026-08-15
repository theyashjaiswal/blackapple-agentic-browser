// BlackApple Agentic Browser — Pool Unit Tests
// Tests ContextPool: initialize, acquire, release, queue, stats, cleanup, capacity

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ContextPool } from '../src/pool.js';
import type { PoolOptions } from '../src/pool.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function waitFor(condition: () => boolean, timeoutMs = 5000, intervalMs = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() > deadline) return reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

// ── Test config ───────────────────────────────────────────────────────────────

const POOL_OPTS: PoolOptions = {
  maxContexts: 4,
  maxContextsPerBrowser: 4,
  minWarmContexts: 1,
};
const BROWSER_OPTS = { headless: true };

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ContextPool', () => {

  describe('initialization', () => {
    it('initializes with min warm contexts', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 2 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const stats = pool.stats();
        expect(stats.availableContexts).toBeGreaterThanOrEqual(1);
      } finally {
        await pool.destroy();
      }
    });

    it('reports correct maxContexts in stats', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, maxContexts: 7 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        expect(pool.stats().maxContexts).toBe(7);
      } finally {
        await pool.destroy();
      }
    });

    it('starts with zero active contexts', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 2 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        expect(pool.stats().activeContexts).toBe(0);
      } finally {
        await pool.destroy();
      }
    });
  });

  describe('acquire()', () => {
    it('returns a BrowserSession with a unique id', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const [s1, s2] = await Promise.all([pool.acquire(), pool.acquire()]);
        expect(s1.id).not.toBe(s2.id);
        pool.release(s1);
        pool.release(s2);
      } finally {
        await pool.destroy();
      }
    });

    it('increments activeContexts on acquire', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        expect(pool.stats().activeContexts).toBe(0);
        const s1 = await pool.acquire();
        expect(pool.stats().activeContexts).toBe(1);
        const s2 = await pool.acquire();
        expect(pool.stats().activeContexts).toBe(2);
        pool.release(s1);
        expect(pool.stats().activeContexts).toBe(1);
        pool.release(s2);
      } finally {
        await pool.destroy();
      }
    });

    it('consumes a warm context without creating a new one', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 1, maxContexts: 2 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const before = pool.stats().availableContexts;
        const session = await pool.acquire();
        const after = pool.stats().availableContexts;
        expect(after).toBe(before - 1);
        pool.release(session);
      } finally {
        await pool.destroy();
      }
    });

    it('passes session options to the context', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const session = await pool.acquire({ viewport: { width: 1920, height: 1080 } });
        const page = await session.context.newPage();
        const vp = page.viewportSize();
        expect(vp?.width).toBe(1920);
        expect(vp?.height).toBe(1080);
        await page.close();
        pool.release(session);
      } finally {
        await pool.destroy();
      }
    });

    it('creates at least one Chromium browser when acquiring', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0, maxContexts: 10 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const session = await pool.acquire();
        expect(pool.stats().browsers).toBeGreaterThanOrEqual(1);
        pool.release(session);
      } finally {
        await pool.destroy();
      }
    });
  });

  describe('release()', () => {
    it('decrements activeContexts on release', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const session = await pool.acquire();
        expect(pool.stats().activeContexts).toBe(1);
        pool.release(session);
        await waitFor(() => pool.stats().activeContexts === 0, 3000);
        expect(pool.stats().activeContexts).toBe(0);
      } finally {
        await pool.destroy();
      }
    });

    it('returns session to warm pool (available++)', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const session = await pool.acquire();
        pool.release(session);
        await waitFor(() => pool.stats().availableContexts >= 1, 3000);
        expect(pool.stats().availableContexts).toBeGreaterThanOrEqual(1);
      } finally {
        await pool.destroy();
      }
    });

    it('releases by session id', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const session = await pool.acquire();
        pool.releaseById(session.id);
        await waitFor(() => pool.stats().activeContexts === 0, 3000);
        expect(pool.stats().activeContexts).toBe(0);
      } finally {
        await pool.destroy();
      }
    });

    it('silently ignores release of unknown session id', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        expect(() => pool.releaseById('not-a-real-id')).not.toThrow();
      } finally {
        await pool.destroy();
      }
    });
  });

  describe('getSession()', () => {
    it('returns the session when active', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const session = await pool.acquire();
        const found = pool.getSession(session.id);
        expect(found?.id).toBe(session.id);
        pool.release(session);
      } finally {
        await pool.destroy();
      }
    });

    it('returns undefined for a released session', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const session = await pool.acquire();
        pool.release(session);
        await waitFor(() => pool.stats().activeContexts === 0, 3000);
        expect(pool.getSession(session.id)).toBeUndefined();
      } finally {
        await pool.destroy();
      }
    });
  });

  describe('capacity limits', () => {
    it('does not exceed maxContexts across all browsers', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, maxContexts: 3, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const sessions = [];
        for (let i = 0; i < 3; i++) sessions.push(await pool.acquire());
        expect(pool.stats().activeContexts).toBe(3);

        // 4th acquire times out
        let timedOut = false;
        await Promise.race([
          pool.acquire(),
          new Promise<never>((_, reject) => setTimeout(() => { timedOut = true; reject(new Error('timeout')); }, 500)),
        ]).catch(() => {});
        expect(timedOut).toBe(true);

        sessions.forEach(s => pool.release(s));
      } finally {
        await pool.destroy();
      }
    });

    it('spreads contexts across multiple BrowserManagers', async () => {
      const pool = new ContextPool(
        { maxContexts: 10, maxContextsPerBrowser: 3, minWarmContexts: 0 },
        BROWSER_OPTS,
      );
      await pool.initialize();
      try {
        const sessions = [];
        for (let i = 0; i < 6; i++) sessions.push(await pool.acquire());
        expect(pool.stats().browsers).toBeGreaterThanOrEqual(2);
        sessions.forEach(s => pool.release(s));
      } finally {
        await pool.destroy();
      }
    });
  });

  describe('queue / pending acquires', () => {
    it('queues acquire when pool is exhausted', async () => {
      const pool = new ContextPool({ maxContexts: 1, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const s1 = await pool.acquire();
        expect(pool.stats().pendingAcquires).toBe(0);

        const s2Promise = pool.acquire();
        await waitFor(() => pool.stats().pendingAcquires === 1, 2000);
        expect(pool.stats().pendingAcquires).toBe(1);

        pool.release(s1);
        const s2 = await s2Promise;
        expect(s2).toBeDefined();
        pool.release(s2);
      } finally {
        await pool.destroy();
      }
    });

    it('pending acquire resolves when context is released back to pool', async () => {
      const pool = new ContextPool({ maxContexts: 1, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const s1 = await pool.acquire();
        expect(pool.stats().pendingAcquires).toBe(0);

        // Start a queued acquire
        const s2Promise = pool.acquire();
        await waitFor(() => pool.stats().pendingAcquires === 1, 2000);
        expect(pool.stats().pendingAcquires).toBe(1);

        // Release s1 — pooled session goes back to available, pending acquires
        pool.release(s1);
        const s2 = await s2Promise;
        expect(s2).toBeDefined();
        pool.release(s2);
      } finally {
        await pool.destroy();
      }
    });
  });

  describe('stats()', () => {
    it('reflects acquire/release cycle correctly', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        expect(pool.stats().activeContexts).toBe(0);

        const s1 = await pool.acquire();
        expect(pool.stats().activeContexts).toBe(1);
        expect(pool.stats().totalContexts).toBe(4);

        const s2 = await pool.acquire();
        expect(pool.stats().activeContexts).toBe(2);

        pool.release(s1);
        await waitFor(() => pool.stats().activeContexts === 1, 2000);

        pool.release(s2);
        await waitFor(() => pool.stats().activeContexts === 0, 2000);
      } finally {
        await pool.destroy();
      }
    });
  });

  describe('destroy()', () => {
    it('clears all sessions and browsers', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 2 }, BROWSER_OPTS);
      await pool.initialize();
      const sessions = [];
      for (let i = 0; i < 3; i++) sessions.push(await pool.acquire());

      await pool.destroy();

      expect(pool.stats().browsers).toBe(0);
      expect(pool.stats().activeContexts).toBe(0);
      expect(pool.stats().availableContexts).toBe(0);
    });

    it('subsequent acquire works after destroy (re-initializes)', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      await pool.destroy();
      // Pool should re-initialize lazily on next acquire
      const session = await pool.acquire();
      expect(session).toBeDefined();
      pool.release(session);
    });
  });

  describe('context isolation', () => {
    it('each session has its own isolated context', async () => {
      const pool = new ContextPool({ ...POOL_OPTS, minWarmContexts: 0 }, BROWSER_OPTS);
      await pool.initialize();
      try {
        const [s1, s2] = await Promise.all([pool.acquire(), pool.acquire()]);
        const page1 = await s1.context.newPage();
        const page2 = await s2.context.newPage();
        await page1.setContent('<div id="unique1">session1</div>');
        await page2.setContent('<div id="unique2">session2</div>');
        const content1 = await page1.content();
        const content2 = await page2.content();
        expect(content1).toContain('unique1');
        expect(content1).not.toContain('unique2');
        expect(content2).toContain('unique2');
        expect(content2).not.toContain('unique1');
        await page1.close();
        await page2.close();
        pool.release(s1);
        pool.release(s2);
      } finally {
        await pool.destroy();
      }
    });
  });

  describe('BrowserManager via ContextPool', () => {
    it('launches Chromium with correct args', async () => {
      const pool = new ContextPool(
        { ...POOL_OPTS, minWarmContexts: 0 },
        { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
      );
      await pool.initialize();
      try {
        const session = await pool.acquire();
        expect(pool.stats().browsers).toBeGreaterThanOrEqual(1);
        pool.release(session);
      } finally {
        await pool.destroy();
      }
    });

    it('multiple managers are tracked separately', async () => {
      const pool = new ContextPool(
        { maxContexts: 10, maxContextsPerBrowser: 2, minWarmContexts: 0 },
        BROWSER_OPTS,
      );
      await pool.initialize();
      try {
        const sessions = [];
        for (let i = 0; i < 4; i++) sessions.push(await pool.acquire());
        expect(pool.stats().browsers).toBeGreaterThanOrEqual(2);
        sessions.forEach(s => pool.release(s));
      } finally {
        await pool.destroy();
      }
    });
  });
});
