import { useEffect, useState } from 'react';

function readSessionValue<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function useSessionDraftState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readSessionValue(key, fallback));

  useEffect(() => {
    setValue(readSessionValue(key, fallback));
  }, [key]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage failures (private mode / quota). Draft persistence is best-effort.
    }
  }, [key, value]);

  const clear = () => {
    setValue(fallback);
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  };

  return [value, setValue, clear] as const;
}
