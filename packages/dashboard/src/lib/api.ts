const BASE_URL = '/api';

function getToken(): string | null {
  return localStorage.getItem('ordinex_token');
}

export function setToken(token: string) {
  localStorage.setItem('ordinex_token', token);
}

export function clearToken() {
  localStorage.removeItem('ordinex_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || 'Request failed');
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = {
  auth: {
    signup: (data: { email: string; password: string; name: string }) =>
      request<{ user: any; token: string }>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    login: (data: { email: string; password: string }) =>
      request<{ user: any; token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    me: () => request<{ user: any }>('/auth/me'),
    logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
    refresh: (token: string) =>
      request<{ token: string }>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
  },
  usage: {
    summary: () => request<any>('/usage/summary'),
    daily: (days = 30) => request<{ days: any[] }>(`/usage/daily?days=${days}`),
    recent: (limit = 20) => request<{ logs: any[] }>(`/usage/recent?limit=${limit}`),
  },
  account: {
    profile: () => request<{ user: any }>('/account/profile'),
    updateProfile: (data: { name?: string }) =>
      request<{ user: any }>('/account/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    keys: () => request<{ keys: any[] }>('/account/keys'),
    createKey: (name: string) =>
      request<{ key: any }>('/account/keys', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    deleteKey: (keyId: string) =>
      request<{ ok: boolean }>(`/account/keys/${keyId}`, { method: 'DELETE' }),
  },
};
