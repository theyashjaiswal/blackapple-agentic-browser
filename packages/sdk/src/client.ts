// BlackApple Agentic Browser — TypeScript SDK Client
// Usage: const browser = new BlackApple({ baseUrl: 'http://localhost:3333' });

export interface BlackAppleOptions {
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
}

export interface SessionInfo {
  id: string;
  createdAt: Date;
}

export interface PoolStats {
  active: number;
  available: number;
  pending: number;
  total: number;
}

export interface NavigateResult {
  url: string;
  title: string;
  status: number;
  loadTime: number;
}

export class BlackApple {
  private baseUrl: string;
  private apiKey?: string;

  constructor(private options: BlackAppleOptions = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:3333';
    this.apiKey = options.apiKey;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`BlackApple API error ${res.status}: ${JSON.stringify(err)}`);
    }
    return res.json();
  }

  async health(): Promise<{ status: string; poolReady: boolean; pool: PoolStats }> {
    return this.request('/health');
  }

  async stats(): Promise<PoolStats> {
    return this.request('/v1/pool/stats');
  }

  async acquireSession(): Promise<SessionInfo> {
    return this.request<SessionInfo>('/v1/sessions/acquire', { method: 'POST' });
  }

  async releaseSession(sessionId: string): Promise<void> {
    await this.request(`/v1/sessions/${sessionId}/release`, { method: 'POST' });
  }

  async navigate(sessionId: string, url: string): Promise<NavigateResult> {
    return this.request<NavigateResult>(`/v1/sessions/${sessionId}/navigate`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  // ── WebSocket session (full control) ─────────────────────────────────────

  async wsAcquire(): Promise<{ sessionId: string; ws: WebSocket }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:3333`);
      const timeout = setTimeout(() => { ws.close(); reject(new Error('WS connect timeout')); }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        ws.send(JSON.stringify({ id: 1, method: 'session.acquire' }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === 1 && msg.result?.sessionId) {
          resolve({ sessionId: msg.result.sessionId, ws });
        }
      });

      ws.on('error', reject);
    });
  }

  wsSend(ws: WebSocket, id: number, method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS request timeout')), 30000);
      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
