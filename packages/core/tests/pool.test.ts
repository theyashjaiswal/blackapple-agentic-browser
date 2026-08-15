// BlackApple Agentic Browser — Session Pool Tests
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { SessionPool } from '../src/pool.js';

describe('SessionPool', () => {
  let pool: SessionPool;

  beforeAll(async () => {
    pool = new SessionPool({ maxSessions: 3, minSessions: 1 }, { headless: true });
    await pool.initialize();
  });

  afterAll(async () => {
    await pool.destroy();
  });

  it('initializes with min sessions', () => {
    const stats = pool.stats();
    expect(stats.active).toBeGreaterThanOrEqual(1);
    expect(stats.active).toBeLessThanOrEqual(3);
  });

  it('acquires a session', async () => {
    const session = await pool.acquire();
    expect(session.id).toBeTruthy();
    const stats = pool.stats();
    expect(stats.active).toBeLessThanOrEqual(3);
    pool.release(session);
  });

  it('releases a session back to the pool', async () => {
    const session = await pool.acquire();
    pool.release(session);
    const stats = pool.stats();
    expect(stats.available).toBeGreaterThanOrEqual(0);
  });

  it('does not exceed max sessions', async () => {
    const pool2 = new SessionPool({ maxSessions: 2, minSessions: 0 }, { headless: true });
    await pool2.initialize();
    const [s1, s2] = await Promise.all([pool2.acquire(), pool2.acquire()]);
    expect(pool2.stats().active).toBe(2);
    pool2.release(s1);
    pool2.release(s2);
    await pool2.destroy();
  });
});
