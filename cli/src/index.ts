#!/usr/bin/env node
// BlackApple Agentic Browser — CLI
import { BlackApple } from '@blackapple/agentic-browser-sdk';

const cmd = process.argv[2];

async function main() {
  const browser = new BlackApple({ baseUrl: process.env.BLACKAPPLE_URL || 'http://localhost:3333' });

  switch (cmd) {
    case 'health': {
      const h = await browser.health();
      console.log(JSON.stringify(h, null, 2));
      break;
    }
    case 'stats': {
      const s = await browser.stats();
      console.log(JSON.stringify(s, null, 2));
      break;
    }
    case 'acquire': {
      const session = await browser.acquireSession();
      console.log(`Session acquired: ${session.id}`);
      break;
    }
    case 'release': {
      const sessionId = process.argv[3];
      if (!sessionId) { console.error('Usage: blackapple release <session-id>'); process.exit(1); }
      await browser.releaseSession(sessionId);
      console.log(`Session ${sessionId} released`);
      break;
    }
    case 'navigate': {
      const sessionId = process.argv[3];
      const url = process.argv[4];
      if (!sessionId || !url) { console.error('Usage: blackapple navigate <session-id> <url>'); process.exit(1); }
      const result = await browser.navigate(sessionId, url);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.log(`BlackApple Agentic Browser CLI
Usage:
  blackapple health                  Check API health and pool status
  blackapple stats                    Show session pool stats
  blackapple acquire                  Acquire a browser session
  blackapple release <session-id>     Release a session back to pool
  blackapple navigate <session-id> <url>  Navigate session to URL
  blackapple --help                  Show this help
`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
