import * as vscode from 'vscode';

const DEFAULT_SERVER_URL = 'http://localhost:3741';

export class BackendClient {
  private serverUrl: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    serverUrl?: string,
  ) {
    this.serverUrl = serverUrl || DEFAULT_SERVER_URL;
  }

  async getToken(): Promise<string | undefined> {
    return this.context.secrets.get('ordinex.jwt');
  }

  async setToken(token: string): Promise<void> {
    await this.context.secrets.store('ordinex.jwt', token);
  }

  async clearToken(): Promise<void> {
    await this.context.secrets.delete('ordinex.jwt');
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    if (!token) return false;

    try {
      await this.request('GET', '/api/auth/me');
      return true;
    } catch {
      return false;
    }
  }

  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.serverUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };

      if (response.status === 401) {
        await this.clearToken();
        throw new BackendAuthError(errorBody?.error || 'Authentication required');
      }

      if (response.status === 402) {
        throw new BackendCreditsError(errorBody?.error || 'Insufficient credits');
      }

      throw new BackendError(response.status, errorBody?.error || 'Request failed');
    }

    return response.json() as Promise<T>;
  }

  async requestStream(
    method: string,
    path: string,
    body: unknown,
    onEvent: (eventType: string, data: any) => void,
  ): Promise<void> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.serverUrl}${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };

      if (response.status === 401) {
        await this.clearToken();
        throw new BackendAuthError(errorBody?.error || 'Authentication required');
      }

      if (response.status === 402) {
        throw new BackendCreditsError(errorBody?.error || 'Insufficient credits');
      }

      throw new BackendError(response.status, errorBody?.error || 'Request failed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new BackendError(0, 'No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = 'message';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            onEvent(eventType, data);
          } catch {
            // skip malformed data lines
          }
        }
      }
    }
  }

  async logout(): Promise<void> {
    try {
      await this.request('POST', '/api/auth/logout');
    } catch {
      // Best-effort: clear local token even if server call fails
    }
    await this.clearToken();
  }

  getLoginUrl(): string {
    return `${this.serverUrl}/auth?redirect=vscode`;
  }
}

export class BackendError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'BackendError';
  }
}

export class BackendAuthError extends BackendError {
  constructor(message: string) {
    super(401, message);
    this.name = 'BackendAuthError';
  }
}

export class BackendCreditsError extends BackendError {
  constructor(message: string) {
    super(402, message);
    this.name = 'BackendCreditsError';
  }
}
