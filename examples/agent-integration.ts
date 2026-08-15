// BlackApple Agentic Browser — Agent Integration Examples
// Shows how each AI agent platform can use BlackApple
//
// Supported agents:
//   • Claude Code (claude code --print)
//   • OpenAI Codex / Cody (Natural language → function calls)
//   • Hermes Agent (delegate_task)
//   • Cursor / Windsurf / Roocode (REST API via HTTP)
//   • Custom LLM agents (any HTTP client)
//
// Prerequisites:
//   BlackApple API must be running:  npx tsx packages/api/src/index.ts
//   Default port: 3333

// ─────────────────────────────────────────────────────────────────────────────
// 1. Claude Code (claude code --print)
// ─────────────────────────────────────────────────────────────────────────────
// Claude Code can call shell commands. Use the CLI or REST API.
//
// $ blackapple session acquire
// $ blackapple session navigate --id <session-id> --url https://example.com
// $ blackapple session screenshot --id <session-id> --path /tmp/screenshot.png
// $ blackapple session release --id <session-id>
//
// Or use the REST API directly:
// curl -X POST http://localhost:3333/v1/sessions/acquire
// curl -X POST http://localhost:3333/v1/sessions/<id>/navigate -d '{"url":"https://example.com"}'

// ─────────────────────────────────────────────────────────────────────────────
// 2. OpenAI Codex / Cody — Natural language → browser action
// ─────────────────────────────────────────────────────────────────────────────
// These agents can call functions. Define a browser namespace:

const BLACKAPPLE_API = process.env.BLACKAPPLE_API || 'http://localhost:3333';

/**
 * step: "Think step-by-step: which URL to visit first, then what to click/fill"
 * plan:  List of {action, selector, value?} objects
 */
async function browserAgentLoop(step: string, plan: { action: string; selector?: string; value?: string; url?: string }[]): Promise<string[]> {
  const results: string[] = [];

  // Acquire session
  const res = await fetch(`${BLACKAPPLE_API}/v1/sessions/acquire`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to acquire session: ${res.status}`);
  const { id: sessionId } = await res.json() as { id: string };
  results.push(`Acquired session: ${sessionId}`);

  for (const action of plan) {
    switch (action.action) {
      case 'navigate': {
        const r = await fetch(`${BLACKAPPLE_API}/v1/sessions/${sessionId}/navigate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: action.url }),
        });
        const data = await r.json() as { url: string; title: string; status: number };
        results.push(`Navigated to ${data.url} (status: ${data.status})`);
        break;
      }
      case 'click': {
        await fetch(`${BLACKAPPLE_API}/v1/sessions/${sessionId}/click`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector: action.selector }),
        });
        results.push(`Clicked: ${action.selector}`);
        break;
      }
      case 'fill': {
        await fetch(`${BLACKAPPLE_API}/v1/sessions/${sessionId}/fill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector: action.selector, value: action.value }),
        });
        results.push(`Filled ${action.selector} = "${action.value}"`);
        break;
      }
      case 'screenshot': {
        const r = await fetch(`${BLACKAPPLE_API}/v1/sessions/${sessionId}/screenshot`);
        const buf = await r.arrayBuffer();
        results.push(`Screenshot captured: ${buf.byteLength} bytes`);
        break;
      }
    }
  }

  // Release session
  await fetch(`${BLACKAPPLE_API}/v1/sessions/${sessionId}/release`, { method: 'DELETE' });
  results.push(`Released session: ${sessionId}`);

  return results;
}

// Example: Codex/Cody would generate the plan from natural language:
// "Go to GitHub, search for react repository, take screenshot"
// plan = [
//   { action: 'navigate', url: 'https://github.com' },
//   { action: 'fill', selector: '[aria-label="Search"]', value: 'react' },
//   { action: 'click', selector: '[aria-label="Submit search"]' },
//   { action: 'screenshot' },
// ]

// ─────────────────────────────────────────────────────────────────────────────
// 3. Hermes Agent (delegate_task) — TypeScript SDK
// ─────────────────────────────────────────────────────────────────────────────
// Using the BlackApple TypeScript SDK from packages/sdk:
// import { BlackAppleClient } from '@blackapple/agentic-browser-sdk';
//
// const client = new BlackAppleClient({ baseUrl: 'http://localhost:3333' });
//
// const session = await client.sessions.acquire();
// try {
//   await client.sessions.navigate(session.id, 'https://example.com');
//   const screenshot = await client.sessions.screenshot(session.id);
//   const title = await client.sessions.evaluate(session.id, 'document.title');
//   console.log(`Page title: ${title}`);
// } finally {
//   await client.sessions.release(session.id);
// }

export { browserAgentLoop };
