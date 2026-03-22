import { useState, useCallback, useRef } from 'react';
import { improvePromptWithClaude } from '../lib/tauri';
import { useSettingsStore } from '../stores/settingsStore';

export function useClaude() {
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const aiProvider = useSettingsStore((s) => s.settings?.ai_provider ?? 'claude');

  const send = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;
    cancelledRef.current = false;
    setResponse('');
    setLoading(true);
    setError(null);
    try {
      const result = await improvePromptWithClaude(prompt, undefined, aiProvider);
      if (!cancelledRef.current) {
        setResponse(result);
      }
    } catch (e) {
      if (!cancelledRef.current) {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [aiProvider]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setLoading(false);
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setResponse('');
    setError(null);
    setLoading(false);
  }, []);

  return { response, loading, error, send, cancel, reset };
}
