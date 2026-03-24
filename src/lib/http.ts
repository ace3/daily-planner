// HTTP transport helpers for browser mode (web browser, not Tauri desktop).
// These replace Tauri invoke() calls when running as a web app.

export function isWebBrowser(): boolean {
  return typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ === 'undefined';
}

function getBaseUrl(): string {
  return localStorage.getItem('synq-server-url') || window.location.origin;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('synq-auth-token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function checkResponse(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res;
}

export async function httpGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, getBaseUrl());
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
  }
  const res = await fetch(url.toString(), { headers: getAuthHeaders() });
  await checkResponse(res);
  return res.json();
}

export async function httpPost<T>(path: string, body?: unknown): Promise<T> {
  const url = new URL(path, getBaseUrl());
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: getAuthHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  await checkResponse(res);
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as T);
}

export async function httpPatch<T>(path: string, body?: unknown): Promise<T> {
  const url = new URL(path, getBaseUrl());
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  await checkResponse(res);
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as T);
}

export async function httpPut<T>(path: string, body?: unknown): Promise<T> {
  const url = new URL(path, getBaseUrl());
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  await checkResponse(res);
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as T);
}

export async function httpDelete<T>(path: string): Promise<T> {
  const url = new URL(path, getBaseUrl());
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  await checkResponse(res);
  const text = await res.text();
  return text ? JSON.parse(text) : (undefined as T);
}

/** Extract ?token= from URL on load, store in localStorage, redirect to clean URL */
export function extractAndStoreToken(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (token) {
    localStorage.setItem('synq-auth-token', token);
    // Store server URL as origin
    localStorage.setItem('synq-server-url', url.origin);
    // Remove token from URL without reload
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
  }
}

/** Build SSE URL with token query param (EventSource can't set headers) */
export function getSseUrl(path: string): string {
  const token = localStorage.getItem('synq-auth-token');
  const base = getBaseUrl();
  const url = new URL(path, base);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}
