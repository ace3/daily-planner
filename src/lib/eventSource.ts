// Real-time SSE client for browser mode.
// Connects to GET /api/events and triggers Zustand store refreshes.

import { getSseUrl } from './http';

interface SseHandlers {
  onTaskChanged?: (date: string) => void;
  onSettingsChanged?: () => void;
  onProjectsChanged?: () => void;
  onReportChanged?: (date: string) => void;
  onTemplatesChanged?: () => void;
  onDevicesChanged?: () => void;
}

let es: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let handlers: SseHandlers = {};

function connect() {
  if (es) {
    es.close();
    es = null;
  }
  const url = getSseUrl('/api/events');
  es = new EventSource(url);

  es.addEventListener('task_changed', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as { data?: { date?: string } };
      handlers.onTaskChanged?.(data?.data?.date ?? '');
    } catch { /* ignore parse errors */ }
  });

  es.addEventListener('settings_changed', () => {
    handlers.onSettingsChanged?.();
  });

  es.addEventListener('projects_changed', () => {
    handlers.onProjectsChanged?.();
  });

  es.addEventListener('report_changed', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as { data?: { date?: string } };
      handlers.onReportChanged?.(data?.data?.date ?? '');
    } catch { /* ignore parse errors */ }
  });

  es.addEventListener('templates_changed', () => {
    handlers.onTemplatesChanged?.();
  });

  es.addEventListener('devices_changed', () => {
    handlers.onDevicesChanged?.();
  });

  es.onerror = () => {
    es?.close();
    es = null;
    // Auto-reconnect with 3s delay (EventSource also reconnects natively, but we manage it manually)
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  };
}

export function startSseClient(h: SseHandlers): void {
  handlers = h;
  connect();
}

export function stopSseClient(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  es?.close();
  es = null;
  handlers = {};
}
