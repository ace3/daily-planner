import { useState, useCallback } from 'react';
import { improvePromptWithClaude } from '../lib/tauri';

export function useClaude() {
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;
    setResponse('');
    setLoading(true);
    setError(null);
    try {
      const result = await improvePromptWithClaude(prompt);
      setResponse(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResponse('');
    setError(null);
    setLoading(false);
  }, []);

  return { response, loading, error, send, reset };
}
