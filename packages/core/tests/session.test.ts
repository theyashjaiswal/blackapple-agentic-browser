// BlackApple Agentic Browser — Multi-Tab & Session Tests
// Tests: multi-tab workflows, page management, auth/cookie persistence, full session lifecycle.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { ContextPool } from '../src/pool.js';
import type { PoolOptions } from '../src/pool.js';
import { BrowserSession } from '../src/session.js';

const POOL_OPTS: PoolOptions = {
  maxContexts: 3,
  maxContextsPerBrowser: 3,
  minWarmContexts: 0,
};
const BROWSER_OPTS = { headless: true };

// ── Basic Lifecycle ─────────────────────────────────────────────────────────

describe('BrowserSession — basic lifecycle', () => {
  let pool: ContextPool;
  let session: BrowserSession;

  beforeAll(async () => {
    pool = new ContextPool(POOL_OPTS, BROWSER_OPTS);
    await pool.initialize();
  });
  afterAll(async () => { await pool.destroy(); });
  beforeEach(async () => { session = await pool.acquire(); });
  afterEach(async () => { pool.release(session); });

  it('navigates and returns correct metrics', async () => {
    const r = await session.navigate('https://example.com');
    expect(r.status).toBe(200);
    expect(r.url).toContain('example.com');
    expect(r.title).toBeTruthy();
    expect(r.loadTime).toBeGreaterThan(0);
  });

  it('navigate returns status 0 for unreachable domain', async () => {
    const r = await session.navigate('https://this-domain-does-not-exist-xyz999.com');
    expect(r.status).toBe(0);
  });

  it('click navigates to linked page', async () => {
    await session.navigate('https://example.com');
    const before = await session.evaluate<string>('window.location.href');
    await session.click('a');
    await session.waitForSelector('body');
    const after = await session.evaluate<string>('window.location.href');
    expect(after).not.toBe(before);
  });

  it('throws for non-existent selector on click', async () => {
    await session.navigate('https://example.com');
    await expect(session.click('#does-not-exist')).rejects.toThrow();
  });

  it('fill persists on the page', async () => {
    await session.navigate('data:text/html,<input id="test-input" type="text"/>');
    await session.fill('#test-input', 'Yash Jaiswal');
    const value = await session.evaluate<string>("document.getElementById('test-input').value");
    expect(value).toBe('Yash Jaiswal');
  });

  it('type simulates character-by-character input', async () => {
    await session.navigate('data:text/html,<input id="t" type="text"/>');
    await session.type('#t', 'hello');
    const value = await session.evaluate<string>("document.getElementById('t').value");
    expect(value).toBe('hello');
  });

  it('screenshot returns valid PNG buffer', async () => {
    await session.navigate('data:text/html,<body style="background:#ff0000"></body>');
    const buf = await session.screenshot();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);
    expect(buf[0]).toBe(0x89); // PNG magic
  });

  it('pdf returns valid PDF buffer', async () => {
    await session.navigate('data:text/html,<body><h1>Test</h1></body>');
    const buf = await session.pdf();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);
    expect(buf[0]).toBe(0x25); // %PDF
  });

  it('evaluate returns JS expression result', async () => {
    await session.navigate('data:text/html,<p id="msg">Hello</p>');
    const text = await session.evaluate<string>("document.getElementById('msg').textContent");
    expect(text).toBe('Hello');
  });

  it('evaluate returns computed values', async () => {
    await session.navigate('data:text/html,<body></body>');
    const val = await session.evaluate<number>('() => 42 + 58');
    expect(val).toBe(100);
  });
});

// ── Multi-Tab ──────────────────────────────────────────────────────────────

describe('BrowserSession — multi-tab workflows', () => {
  let pool: ContextPool;
  let session: BrowserSession;

  beforeAll(async () => {
    pool = new ContextPool(POOL_OPTS, BROWSER_OPTS);
    await pool.initialize();
  });
  afterAll(async () => { await pool.destroy(); });
  beforeEach(async () => { session = await pool.acquire(); });
  afterEach(async () => { pool.release(session); });

  it('opens a new tab and it is accessible', async () => {
    await session.navigate('https://example.com');
    const mainUrl = await session.evaluate<string>('window.location.href');
    // openTab(switchTo=true) makes the new tab active — switch back to tab 0
    const tabIndex = await session.openTab('https://httpbin.org/html');
    expect(tabIndex).toBe(1);
    const tabUrl = await session.evaluateOn<string>('window.location.href', tabIndex);
    expect(tabUrl).toContain('httpbin.org');
    // Switch back to tab 0 and verify it's still on example.com
    await session.switchPage(0);
    const backUrl = await session.evaluate<string>('window.location.href');
    expect(backUrl).toBe(mainUrl);
  });

  it('newPage() creates an accessible blank page', async () => {
    await session.navigate('https://example.com');
    const idx = await session.newPage();
    expect(idx).toBe(1);
    expect(session.pageCount()).toBe(2);
  });

  it('pageUrls() returns all open page URLs', async () => {
    await session.navigate('https://example.com');
    await session.openTab('https://httpbin.org/html', false);
    await session.openTab('data:text/html,<h1>Tab3</h1>', false);
    const urls = session.pageUrls();
    expect(urls.length).toBe(3);
    expect(urls[0]).toContain('example.com');
    expect(urls[1]).toContain('httpbin.org');
    expect(urls[2]).toMatch(/^data:text/);
  });

  it('switchPage() changes active page', async () => {
    await session.navigate('data:text/html,<title>Page0</title><body></body>');
    await session.openTab('data:text/html,<title>Page1</title><body></body>', false);
    // Verify we're on page 0
    const title0 = await session.evaluate<string>('document.title');
    expect(title0).toBe('Page0');
    // Switch to page 1
    await session.switchPage(1);
    const title1 = await session.evaluate<string>('document.title');
    expect(title1).toBe('Page1');
  });

  it('closePage() closes specific tab', async () => {
    await session.navigate('https://example.com');
    const idx = await session.openTab('https://httpbin.org/html', true);
    expect(session.pageCount()).toBe(2);
    await session.closePage(idx);
    expect(session.pageCount()).toBe(1);
    // Still on original page
    const url = await session.evaluate<string>('window.location.href');
    expect(url).toContain('example.com');
  });

  it('closePage() with no index closes active page', async () => {
    await session.navigate('https://example.com');
    await session.openTab('https://httpbin.org/html', true);
    expect(session.pageCount()).toBe(2);
    await session.closePage(); // close active (tab 1)
    expect(session.pageCount()).toBe(1);
    // Should have switched back to tab 0
    const url = await session.evaluate<string>('window.location.href');
    expect(url).toContain('example.com');
  });

  it('closeOtherPages() keeps only active open', async () => {
    await session.navigate('https://example.com');
    await session.openTab('https://httpbin.org/html', false);
    await session.openTab('data:text/html,<h1>Tab3</h1>', false);
    expect(session.pageCount()).toBe(3);
    await session.closeOtherPages();
    expect(session.pageCount()).toBe(1);
  });

  it('navigate creates a new page if none exist', async () => {
    // Start fresh — no pages yet
    const r = await session.navigate('https://example.com');
    expect(r.status).toBe(200);
    expect(session.pageCount()).toBe(1);
  });

  it('navigate on existing page navigates it', async () => {
    await session.navigate('https://example.com');
    const r = await session.navigate('https://httpbin.org/html');
    expect(r.url).toContain('httpbin.org');
    expect(session.pageCount()).toBe(1); // same page, navigated
  });

  it('openTab without switchTo keeps original active', async () => {
    await session.navigate('https://example.com');
    await session.openTab('https://httpbin.org/html', false);
    const title = await session.evaluate<string>('document.title');
    expect(title).toContain('Example');
  });

  it('evaluateOn() runs on specific tab', async () => {
    await session.navigate('https://example.com');
    await session.openTab('data:text/html,<div id="tab2">Content from tab 2</div>', true);
    const text = await session.evaluateOn<string>("document.getElementById('tab2').textContent", 1);
    expect(text).toBe('Content from tab 2');
  });

  it('screenshot of specific tab', async () => {
    await session.navigate('data:text/html,<body style="background:red"></body>');
    const tabIdx = await session.openTab('data:text/html,<body style="background:blue"></body>', true);
    const buf = await session.screenshot({ pageIndex: 0 }); // screenshot tab 0
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('throws when switching to out-of-range page', async () => {
    await session.navigate('https://example.com');
    await expect(session.switchPage(99)).rejects.toThrow('out of range');
  });

  it('throws when evaluating on closed page', async () => {
    await session.navigate('https://example.com');
    await session.openTab('https://httpbin.org/html', false);
    await session.closePage(1);
    await expect(session.evaluateOn('document.title', 1)).rejects.toThrow('No page');
  });
});

// ── Auth & Cookie Persistence ───────────────────────────────────────────────

describe('BrowserSession — auth & cookie persistence', () => {
  let pool: ContextPool;
  let session: BrowserSession;

  beforeAll(async () => {
    pool = new ContextPool(POOL_OPTS, BROWSER_OPTS);
    await pool.initialize();
  });
  afterAll(async () => { await pool.destroy(); });
  beforeEach(async () => { session = await pool.acquire(); });
  afterEach(async () => { pool.release(session); });

  it('localStorage persists across navigation within same tab', async () => {
    await session.navigate('https://example.com');
    await session.evaluate(() => localStorage.setItem('token', 'abc-123'));
    await session.navigate('https://example.com');
    const token = await session.evaluate<string>('localStorage.getItem("token")');
    expect(token).toBe('abc-123');
  });

  it('localStorage persists across tabs in same session (shared within context)', async () => {
    // localStorage is shared across tabs within the SAME origin/context.
    // This tests that behavior: setting in tab 0 is visible in tab 1.
    await session.navigate('https://example.com');
    await session.evaluate(() => localStorage.setItem('session', 'main-tab'));
    const tabIdx = await session.openTab('https://example.com', true);
    // Tab 1 inherits the same localStorage from the shared context
    const tabValue = await session.evaluate<string>('localStorage.getItem("session")');
    expect(tabValue).toBe('main-tab');
  });

  it('localStorage is isolated between DIFFERENT sessions (different contexts)', async () => {
    // Isolation between sessions = different contexts = different localStorage partitions
    const [s1, s2] = await Promise.all([pool.acquire(), pool.acquire()]);
    await s1.navigate('https://example.com');
    await s2.navigate('https://example.com');
    await s1.evaluate(() => localStorage.setItem('token', 's1-secret'));
    const s2token = await s2.evaluate<string>('localStorage.getItem("token")');
    expect(s2token).toBeNull(); // s2's separate context has no s1's token
    pool.release(s1);
    pool.release(s2);
  });

  it('cookies set in one tab are visible in another tab', async () => {
    await session.navigate('https://example.com');
    await session.evaluate(() => { document.cookie = 'user=hash; path=/'; });
    const tabIdx = await session.openTab('https://example.com', true);
    const cookie = await session.evaluateOn<string>('document.cookie', tabIdx);
    expect(cookie).toContain('user=hash');
  });

  it('sessionStorage persists across page navigations', async () => {
    await session.navigate('https://example.com');
    await session.evaluate(() => sessionStorage.setItem('key', 'value1'));
    await session.navigate('https://example.com');
    const v = await session.evaluate<string>('sessionStorage.getItem("key")');
    expect(v).toBe('value1');
  });
});

// ── Pool Isolation ─────────────────────────────────────────────────────────

describe('BrowserSession — pool isolation', () => {
  let pool: ContextPool;

  beforeAll(async () => {
    pool = new ContextPool(POOL_OPTS, BROWSER_OPTS);
    await pool.initialize();
  });
  afterAll(async () => { await pool.destroy(); });

  it('two sessions have isolated localStorage', async () => {
    // Different contexts = different localStorage partitions
    const [s1, s2] = await Promise.all([pool.acquire(), pool.acquire()]);
    await s1.navigate('https://example.com');
    await s2.navigate('https://example.com');
    await s1.evaluate(() => localStorage.setItem('token', 's1-secret'));
    const s2token = await s2.evaluate<string>('localStorage.getItem("token")');
    expect(s2token).toBeNull();
    pool.release(s1);
    pool.release(s2);
  });

  it('two sessions can be on different URLs simultaneously', async () => {
    const [s1, s2] = await Promise.all([pool.acquire(), pool.acquire()]);
    const [r1, r2] = await Promise.all([
      s1.navigate('https://example.com'),
      s2.navigate('https://httpbin.org/html'),
    ]);
    expect(r1.url).toContain('example.com');
    expect(r2.url).toContain('httpbin.org');
    pool.release(s1);
    pool.release(s2);
  });

  it('pool.acquire() returns session with unique id', async () => {
    const [s1, s2] = await Promise.all([pool.acquire(), pool.acquire()]);
    expect(s1.id).not.toBe(s2.id);
    pool.release(s1);
    pool.release(s2);
  });
});

// ── Close & Pool Lifecycle ─────────────────────────────────────────────────

describe('BrowserSession — close & pool lifecycle', () => {
  let pool: ContextPool;

  beforeAll(async () => {
    pool = new ContextPool(POOL_OPTS, BROWSER_OPTS);
    await pool.initialize();
  });
  afterAll(async () => { await pool.destroy(); });

  it('release() removes session from active pool', async () => {
    const session = await pool.acquire();
    const id = session.id;
    pool.release(session);
    expect(pool.getSession(id)).toBeUndefined();
  });

  it('close() makes navigate throw', async () => {
    const session = await pool.acquire();
    await session.close();
    await expect(session.navigate('https://example.com')).rejects.toThrow();
  });

  it('pool.stats() reflects acquire/release cycle', async () => {
    // Record baseline — other tests may have leaked sessions
    const baseline = pool.stats().activeContexts;
    const s1 = await pool.acquire();
    expect(pool.stats().activeContexts).toBe(baseline + 1);
    const s2 = await pool.acquire();
    expect(pool.stats().activeContexts).toBe(baseline + 2);
    pool.release(s1);
    expect(pool.stats().activeContexts).toBe(baseline + 1);
    pool.release(s2);
    // Back to baseline
    expect(pool.stats().activeContexts).toBe(baseline);
  });
});
