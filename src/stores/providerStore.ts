import { create } from 'zustand';
import { checkCliAvailability } from '../lib/tauri';

export type Provider = 'claude' | 'codex';

const STORAGE_KEY = 'active_provider';

interface ProviderState {
  activeProvider: Provider;
  claudeAvailable: boolean;
  codexAvailable: boolean;
  setActiveProvider: (provider: Provider) => void;
  checkAvailability: () => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set) => {
  const stored = localStorage.getItem(STORAGE_KEY);
  const initialProvider: Provider = stored === 'codex' ? 'codex' : 'claude';

  return {
    activeProvider: initialProvider,
    claudeAvailable: false,
    codexAvailable: false,

    setActiveProvider: (provider) => {
      localStorage.setItem(STORAGE_KEY, provider);
      set({ activeProvider: provider });
    },

    checkAvailability: async () => {
      try {
        const status = await checkCliAvailability();
        set({ claudeAvailable: status.claude_available, codexAvailable: status.codex_available });
      } catch {
        set({ claudeAvailable: false, codexAvailable: false });
      }
    },
  };
});
