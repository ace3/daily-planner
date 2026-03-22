import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSessionStore } from '../stores/sessionStore';

export function usePhaseListener() {
  const { tick } = useSessionStore();

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<{ phase: string }>('phase-changed', (_event) => {
      // Re-tick to update session info when a phase changes
      tick();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [tick]);
}
