import { useState, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { sendPrompt } from '../lib/tauri';
import { useSettingsStore } from '../stores/settingsStore';

interface StreamChunk {
  text: string;
  done: boolean;
  error?: string;
}

export function useClaude() {
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const { settings } = useSettingsStore();

  const send = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;

    setResponse('');
    setLoading(true);
    setError(null);

    const eventName = `claude-stream-${Date.now()}`;

    if (unlistenRef.current) {
      unlistenRef.current();
    }

    unlistenRef.current = await listen<StreamChunk>(eventName, (event) => {
      const chunk = event.payload;
      if (chunk.error) {
        setError(chunk.error);
        setLoading(false);
        return;
      }
      if (chunk.done) {
        setLoading(false);
        return;
      }
      setResponse((prev) => prev + chunk.text);
    });

    try {
      await sendPrompt(prompt, settings?.claude_model ?? null, eventName);
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }, [settings]);

  const reset = useCallback(() => {
    setResponse('');
    setError(null);
    setLoading(false);
  }, []);

  return { response, loading, error, send, reset };
}
