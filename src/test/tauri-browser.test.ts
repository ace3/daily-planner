/**
 * Tests for tauri.ts browser-mode HTTP transport.
 * Each test deletes __TAURI_INTERNALS__ so isWebBrowser() returns true,
 * then restores it in afterEach so other test files are unaffected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getTasks,
  getTask,
  createTask,
  updateTaskStatus,
  deleteTask,
  getSettings,
  setSetting,
  getProjects,
  getGlobalPrompt,
  setGlobalPrompt,
  getLocalIp,
  getHttpServerPort,
} from '../lib/tauri';

const BASE = 'http://localhost:3000';

// Helpers ---------------------------------------------------------------

function mockFetchJson(body: unknown, status = 200) {
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

function lastFetchCall(): [string, RequestInit] {
  return vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
}

// Setup / teardown -------------------------------------------------------

let savedInternals: unknown;

beforeEach(() => {
  // Switch to browser mode
  const win = window as unknown as Record<string, unknown>;
  savedInternals = win.__TAURI_INTERNALS__;
  delete win.__TAURI_INTERNALS__;

  localStorage.clear();

  Object.defineProperty(window, 'location', {
    value: {
      origin: BASE,
      href: BASE + '/',
      hostname: 'localhost',
      port: '',
    },
    writable: true,
  });
});

afterEach(() => {
  // Restore Tauri desktop mode so other test files are unaffected
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = savedInternals;
  vi.restoreAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

describe('getTasks (browser mode)', () => {
  it('GETs /api/tasks', async () => {
    mockFetchJson([]);
    const result = await getTasks();
    const [url, opts] = lastFetchCall();
    expect(url).toContain('/api/tasks');
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(result).toEqual([]);
  });
});

describe('getTask (browser mode)', () => {
  it('GETs /api/tasks/:id', async () => {
    const task = { id: 'task-123', title: 'Single task' };
    mockFetchJson(task);
    const result = await getTask('task-123');
    const [url, opts] = lastFetchCall();
    expect(url).toContain('/api/tasks/task-123');
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(result).toEqual(task);
  });
});

describe('createTask (browser mode)', () => {
  it('POSTs /api/tasks and returns id', async () => {
    mockFetchJson({ id: 'task-abc' });
    const id = await createTask({ date: '2026-03-23', session_slot: 1, title: 'Write tests' });
    const [url, opts] = lastFetchCall();
    expect(url).toContain('/api/tasks');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.title).toBe('Write tests');
    expect(id).toBe('task-abc');
  });
});

describe('updateTaskStatus (browser mode)', () => {
  it('PATCHes /api/tasks/:id/status with status payload', async () => {
    mockFetchJson('');
    await updateTaskStatus('task-id', 'done');
    const [url, opts] = lastFetchCall();
    expect(url).toContain('/api/tasks/task-id/status');
    expect(opts.method).toBe('PATCH');
    const body = JSON.parse(opts.body as string);
    expect(body.status).toBe('done');
  });
});

describe('deleteTask (browser mode)', () => {
  it('DELETEs /api/tasks/:id', async () => {
    mockFetchJson('');
    await deleteTask('task-id');
    const [url, opts] = lastFetchCall();
    expect(url).toContain('/api/tasks/task-id');
    expect(opts.method).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('getSettings (browser mode)', () => {
  it('GETs /api/settings', async () => {
    const settings = { theme: 'dark', language: 'en' };
    mockFetchJson(settings);
    const result = await getSettings();
    const [url] = lastFetchCall();
    expect(url).toContain('/api/settings');
    expect(result).toEqual(settings);
  });
});

describe('setSetting (browser mode)', () => {
  it('PUTs /api/settings/:key with value payload', async () => {
    mockFetchJson('');
    await setSetting('theme', 'dark');
    const [url, opts] = lastFetchCall();
    expect(url).toContain('/api/settings/theme');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body as string);
    expect(body.value).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

describe('getProjects (browser mode)', () => {
  it('GETs /api/projects', async () => {
    const projects = [{ id: 'p1', name: 'Project One' }];
    mockFetchJson(projects);
    const result = await getProjects();
    const [url] = lastFetchCall();
    expect(url).toContain('/api/projects');
    expect(result).toEqual(projects);
  });
});

// ---------------------------------------------------------------------------
// Global prompt
// ---------------------------------------------------------------------------

describe('getGlobalPrompt (browser mode)', () => {
  it('GETs /api/prompt/global and unwraps prompt field', async () => {
    mockFetchJson({ prompt: 'You are a helpful assistant.' });
    const result = await getGlobalPrompt();
    const [url] = lastFetchCall();
    expect(url).toContain('/api/prompt/global');
    expect(result).toBe('You are a helpful assistant.');
  });

  it('returns null when prompt field is null', async () => {
    mockFetchJson({ prompt: null });
    const result = await getGlobalPrompt();
    expect(result).toBeNull();
  });
});

describe('setGlobalPrompt (browser mode)', () => {
  it('PUTs /api/prompt/global with prompt payload', async () => {
    mockFetchJson('');
    await setGlobalPrompt('my prompt');
    const [url, opts] = lastFetchCall();
    expect(url).toContain('/api/prompt/global');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body as string);
    expect(body.prompt).toBe('my prompt');
  });
});

// ---------------------------------------------------------------------------
// Remote access helpers
// ---------------------------------------------------------------------------

describe('getLocalIp (browser mode)', () => {
  it('returns window.location.hostname', async () => {
    Object.defineProperty(window, 'location', {
      value: { origin: BASE, hostname: '192.168.1.5', port: '7734' },
      writable: true,
    });
    const ip = await getLocalIp();
    expect(ip).toBe('192.168.1.5');
  });
});

describe('getHttpServerPort (browser mode)', () => {
  it('returns parsed port number from window.location.port', async () => {
    Object.defineProperty(window, 'location', {
      value: { origin: BASE, hostname: 'localhost', port: '8080' },
      writable: true,
    });
    const port = await getHttpServerPort();
    expect(port).toBe(8080);
  });

  it('returns 7734 when window.location.port is empty string', async () => {
    Object.defineProperty(window, 'location', {
      value: { origin: BASE, hostname: 'localhost', port: '' },
      writable: true,
    });
    const port = await getHttpServerPort();
    expect(port).toBe(7734);
  });
});
