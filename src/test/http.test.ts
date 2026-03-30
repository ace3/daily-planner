import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isWebBrowser, httpGet, httpPost, httpPatch, httpPut, httpDelete, extractAndStoreToken, getSseUrl, getStoredToken, clearStoredToken } from '../lib/http';

// setup.ts sets window.__TAURI_INTERNALS__ = {} so isWebBrowser() returns false by default.

const BASE = 'http://localhost:3000';

function mockFetchOk(body: unknown, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const res = {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: vi.fn().mockResolvedValue(text),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
  return res;
}

function mockFetchError(status: number, body = 'Bad Request') {
  const res = {
    ok: false,
    status,
    statusText: body,
    text: vi.fn().mockResolvedValue(body),
    json: vi.fn(),
  } as unknown as Response;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
  return res;
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = 'synq-token=; Max-Age=0; path=/';
  // Set a known origin so URL construction is deterministic
  Object.defineProperty(window, 'location', {
    value: { origin: BASE, href: BASE + '/', hostname: 'localhost', port: '', search: '', pathname: '/' },
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.cookie = 'synq-token=; Max-Age=0; path=/';
});

// ---------------------------------------------------------------------------
// isWebBrowser
// ---------------------------------------------------------------------------

describe('isWebBrowser', () => {
  it('returns false when __TAURI_INTERNALS__ is set (default test env)', () => {
    expect(isWebBrowser()).toBe(false);
  });

  it('returns true when __TAURI_INTERNALS__ is undefined', () => {
    const win = window as unknown as Record<string, unknown>;
    const original = win.__TAURI_INTERNALS__;
    delete win.__TAURI_INTERNALS__;
    expect(isWebBrowser()).toBe(true);
    win.__TAURI_INTERNALS__ = original;
  });
});

// ---------------------------------------------------------------------------
// httpGet
// ---------------------------------------------------------------------------

describe('httpGet', () => {
  it('calls fetch with GET method and correct URL', async () => {
    mockFetchOk({ items: [] });
    await httpGet('/api/tasks');
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/tasks`);
    expect(opts.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }));
  });

  it('appends query params to URL', async () => {
    mockFetchOk([]);
    await httpGet('/api/tasks', { date: '2026-03-23' });
    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('date=2026-03-23');
  });

  it('includes Authorization header when token is stored', async () => {
    localStorage.setItem('synq-auth-token', 'tok123');
    mockFetchOk({});
    await httpGet('/api/settings');
    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
  });

  it('omits Authorization header when no token', async () => {
    mockFetchOk({});
    await httpGet('/api/settings');
    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('throws on non-ok response', async () => {
    mockFetchError(404, 'Not Found');
    await expect(httpGet('/api/missing')).rejects.toThrow('HTTP 404');
  });

  it('uses synq-server-url from localStorage as base when set', async () => {
    localStorage.setItem('synq-server-url', 'http://192.168.1.10:7734');
    mockFetchOk([]);
    await httpGet('/api/tasks');
    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('http://192.168.1.10:7734');
  });
});

// ---------------------------------------------------------------------------
// httpPost
// ---------------------------------------------------------------------------

describe('httpPost', () => {
  it('calls fetch with POST method and JSON body', async () => {
    mockFetchOk({ id: 'abc' });
    await httpPost('/api/tasks', { title: 'Test' });
    const [url, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/tasks`);
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(JSON.stringify({ title: 'Test' }));
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends no body when body is undefined', async () => {
    mockFetchOk('');
    await httpPost('/api/tasks/rollover');
    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(opts.body).toBeUndefined();
  });

  it('returns undefined when response body is empty', async () => {
    mockFetchOk('');
    const result = await httpPost('/api/endpoint');
    expect(result).toBeUndefined();
  });

  it('throws on non-ok response', async () => {
    mockFetchError(500, 'Server Error');
    await expect(httpPost('/api/tasks', {})).rejects.toThrow('HTTP 500');
  });
});

// ---------------------------------------------------------------------------
// httpPatch
// ---------------------------------------------------------------------------

describe('httpPatch', () => {
  it('calls fetch with PATCH method', async () => {
    mockFetchOk('');
    await httpPatch('/api/tasks/1/status', { status: 'done' });
    const [url, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/tasks/1/status`);
    expect(opts.method).toBe('PATCH');
    expect(opts.body).toBe(JSON.stringify({ status: 'done' }));
  });

  it('throws on non-ok response', async () => {
    mockFetchError(400, 'Bad Request');
    await expect(httpPatch('/api/tasks/x/status', {})).rejects.toThrow('HTTP 400');
  });
});

// ---------------------------------------------------------------------------
// httpPut
// ---------------------------------------------------------------------------

describe('httpPut', () => {
  it('calls fetch with PUT method', async () => {
    mockFetchOk('');
    await httpPut('/api/settings/theme', { value: 'dark' });
    const [url, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/settings/theme`);
    expect(opts.method).toBe('PUT');
    expect(opts.body).toBe(JSON.stringify({ value: 'dark' }));
  });

  it('throws on non-ok response', async () => {
    mockFetchError(403, 'Forbidden');
    await expect(httpPut('/api/settings/key', {})).rejects.toThrow('HTTP 403');
  });
});

// ---------------------------------------------------------------------------
// httpDelete
// ---------------------------------------------------------------------------

describe('httpDelete', () => {
  it('calls fetch with DELETE method', async () => {
    mockFetchOk('');
    await httpDelete('/api/tasks/1');
    const [url, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/tasks/1`);
    expect(opts.method).toBe('DELETE');
  });

  it('throws on non-ok response', async () => {
    mockFetchError(404, 'Not Found');
    await expect(httpDelete('/api/tasks/missing')).rejects.toThrow('HTTP 404');
  });
});

// ---------------------------------------------------------------------------
// extractAndStoreToken
// ---------------------------------------------------------------------------

describe('extractAndStoreToken', () => {
  it('stores token in localStorage and removes it from URL', () => {
    const replaceState = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        href: `${BASE}/?token=mytoken123`,
        origin: BASE,
        hostname: 'localhost',
        port: '',
      },
      writable: true,
    });
    Object.defineProperty(window, 'history', {
      value: { replaceState },
      writable: true,
    });

    extractAndStoreToken();

    expect(localStorage.getItem('synq-auth-token')).toBe('mytoken123');
    expect(localStorage.getItem('synq-server-url')).toBe(BASE);
    expect(replaceState).toHaveBeenCalledOnce();
    const cleanUrl: string = replaceState.mock.calls[0][2];
    expect(cleanUrl).not.toContain('token=');
  });

  it('is a no-op when there is no token in URL', () => {
    const replaceState = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { href: `${BASE}/`, origin: BASE, hostname: 'localhost', port: '' },
      writable: true,
    });
    Object.defineProperty(window, 'history', {
      value: { replaceState },
      writable: true,
    });

    extractAndStoreToken();

    expect(localStorage.getItem('synq-auth-token')).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getSseUrl
// ---------------------------------------------------------------------------

describe('getSseUrl', () => {
  it('includes token as query param when token is in localStorage', () => {
    localStorage.setItem('synq-auth-token', 'ssetoken');
    const url = getSseUrl('/api/events');
    expect(url).toContain('token=ssetoken');
    expect(url).toContain('/api/events');
  });

  it('does not include token param when no token stored', () => {
    const url = getSseUrl('/api/events');
    expect(url).not.toContain('token=');
    expect(url).toContain('/api/events');
  });

  it('uses synq-server-url as base when set', () => {
    localStorage.setItem('synq-server-url', 'http://10.0.0.5:7734');
    const url = getSseUrl('/api/events');
    expect(url).toContain('http://10.0.0.5:7734');
  });
});

// ---------------------------------------------------------------------------
// getStoredToken — localStorage → cookie fallback
// ---------------------------------------------------------------------------

describe('getStoredToken', () => {
  beforeEach(() => {
    document.cookie = 'synq-token=; Max-Age=0; path=/';
  });

  it('returns token from localStorage when present', () => {
    localStorage.setItem('synq-auth-token', 'ls-token');
    expect(getStoredToken()).toBe('ls-token');
  });

  it('falls back to cookie when localStorage is empty', () => {
    document.cookie = 'synq-token=cookie-token; path=/';
    expect(getStoredToken()).toBe('cookie-token');
  });

  it('prefers localStorage over cookie', () => {
    localStorage.setItem('synq-auth-token', 'ls-token');
    document.cookie = 'synq-token=cookie-token; path=/';
    expect(getStoredToken()).toBe('ls-token');
  });

  it('returns null when neither localStorage nor cookie has token', () => {
    expect(getStoredToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clearStoredToken — clears both localStorage and cookie
// ---------------------------------------------------------------------------

describe('clearStoredToken', () => {
  it('clears token from both localStorage and cookie', () => {
    localStorage.setItem('synq-auth-token', 'tok');
    document.cookie = 'synq-token=tok; path=/';
    clearStoredToken();
    expect(localStorage.getItem('synq-auth-token')).toBeNull();
    expect(document.cookie).not.toContain('synq-token=tok');
  });
});

// ---------------------------------------------------------------------------
// extractAndStoreToken — cookie persistence
// ---------------------------------------------------------------------------

describe('extractAndStoreToken (cookie)', () => {
  beforeEach(() => {
    document.cookie = 'synq-token=; Max-Age=0; path=/';
  });

  it('sets synq-token cookie alongside localStorage when token is in URL', () => {
    const replaceState = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        href: `${BASE}/?token=mytoken123`,
        origin: BASE,
        hostname: 'localhost',
        port: '',
      },
      writable: true,
    });
    Object.defineProperty(window, 'history', {
      value: { replaceState },
      writable: true,
    });

    extractAndStoreToken();

    expect(localStorage.getItem('synq-auth-token')).toBe('mytoken123');
    expect(document.cookie).toContain('synq-token=mytoken123');
  });

  it('sets Secure flag on cookie when served over HTTPS (cloudflared)', () => {
    const replaceState = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        href: 'https://myapp.trycloudflare.com/?token=sec-token',
        origin: 'https://myapp.trycloudflare.com',
        hostname: 'myapp.trycloudflare.com',
        port: '',
        protocol: 'https:',
      },
      writable: true,
    });
    Object.defineProperty(window, 'history', {
      value: { replaceState },
      writable: true,
    });

    extractAndStoreToken();

    expect(localStorage.getItem('synq-auth-token')).toBe('sec-token');
    expect(document.cookie).toContain('synq-token=sec-token');
  });

  it('does not set cookie when there is no token in URL', () => {
    const replaceState = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { href: `${BASE}/`, origin: BASE, hostname: 'localhost', port: '' },
      writable: true,
    });
    Object.defineProperty(window, 'history', {
      value: { replaceState },
      writable: true,
    });

    extractAndStoreToken();

    expect(document.cookie).not.toContain('synq-token=');
  });
});

// ---------------------------------------------------------------------------
// httpGet — cookie fallback for auth header
// ---------------------------------------------------------------------------

describe('httpGet (cookie auth fallback)', () => {
  beforeEach(() => {
    document.cookie = 'synq-token=; Max-Age=0; path=/';
  });

  it('uses cookie token for Authorization header when localStorage is empty', async () => {
    document.cookie = 'synq-token=cookie-tok; path=/';
    mockFetchOk({});
    await httpGet('/api/settings');
    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer cookie-tok');
  });
});
