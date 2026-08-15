// BlackApple Agentic Browser — Core Tests
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { BrowserEngine, BrowserSession } from '../src/session.js';
import type { BrowserLaunchOptions, SessionOptions } from '../src/types.js';

describe('BrowserSession', () => {
  let engine: BrowserEngine;
  let session: BrowserSession;

  beforeAll(async () => {
    engine = new BrowserEngine({ headless: true });
    await engine.launch();
  });

  afterAll(async () => {
    await engine.close();
  });

  beforeEach(async () => {
    session = await engine.createSession();
  });

  afterEach(async () => {
    await session.close();
  });

  it('creates a session with a unique id', async () => {
    const s1 = await engine.createSession();
    const s2 = await engine.createSession();
    expect(s1.id).not.toBe(s2.id);
    await s2.close();
  });

  it('navigates to a URL and returns page metrics', async () => {
    const result = await session.navigate('https://example.com');
    expect(result.url).toContain('example.com');
    expect(result.title).toBeTruthy();
    expect(result.content).toContain('<html');
  });

  it('clicks an element by selector', async () => {
    await session.navigate('https://example.com');
    const title = await session.title();
    await session.click('a');
    // Clicking the link navigates away
    const newUrl = session.url;
    expect(newUrl).not.toBe('https://example.com/');
  });

  it('fills and types into an input', async () => {
    await session.navigate('https://example.com/contact');
    const input = await session.$('input[type="text"]');
    if (input) {
      await session.fill('input[type="text"]', 'Test User');
      const value = await session.evaluate(() => {
        const el = document.querySelector('input[type="text"]') as HTMLInputElement;
        return el?.value;
      });
      expect(value).toBe('Test User');
    }
  });

  it('evaluates JavaScript on the page', async () => {
    await session.navigate('https://example.com');
    const title = await session.evaluate('document.title');
    expect(title).toBe('Example Domain');
  });

  it('takes a screenshot', async () => {
    await session.navigate('https://example.com');
    const screenshot = await session.screenshot();
    expect(screenshot).toBeInstanceOf(Buffer);
    expect(screenshot.length).toBeGreaterThan(1000);
  });

  it('throws on closed session', async () => {
    await session.close();
    await expect(session.navigate('https://example.com')).rejects.toThrow();
  });
});

describe('BrowserEngine', () => {
  it('launches in headless mode', async () => {
    const engine = new BrowserEngine({ headless: true });
    await engine.launch();
    expect(engine.isLaunched()).toBe(true);
    await engine.close();
  });

  it('creates multiple isolated sessions', async () => {
    const engine = new BrowserEngine({ headless: true });
    await engine.launch();
    const [s1, s2] = await Promise.all([
      engine.createSession(),
      engine.createSession(),
    ]);
    expect(s1.id).not.toBe(s2.id);
    await Promise.all([s1.close(), s2.close()]);
    await engine.close();
  });

  it('respects viewport option', async () => {
    const engine = new BrowserEngine({ headless: true });
    await engine.launch();
    const session = await engine.createSession({ viewport: { width: 1920, height: 1080 } });
    const viewport = await session.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    expect(viewport.width).toBe(1920);
    expect(viewport.height).toBe(1080);
    await session.close();
    await engine.close();
  });
});
