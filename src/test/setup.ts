import '@testing-library/jest-dom';

// Simulate Tauri desktop environment so isWebBrowser() returns false in tests.
// Without this, all tauri.ts wrappers branch to the HTTP path and tests fail.
(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));
