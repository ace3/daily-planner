import { useState, useCallback } from 'react';
import { improvePromptWithClaude } from '../lib/tauri';
import { useSettingsStore } from '../stores/settingsStore';

export function useClaude() {
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiProvider = useSettingsStore((s) => s.settings?.ai_provider ?? 'claude');

  const send = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;
    setResponse('');
    setLoading(true);
    setError(null);
    try {
      const result = await improvePromptWithClaude(prompt, undefined, aiProvider);
      setResponse(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [aiProvider]);

  const reset = useCallback(() => {
    setResponse('');
    setError(null);
    setLoading(false);
  }, []);

  return { response, loading, error, send, reset };
}
