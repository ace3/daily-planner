import { create } from 'zustand';
import { detectAiProviders } from '../lib/tauri';

interface ProviderState {
  claudeAvailable: boolean;
  opencodeAvailable: boolean;
  codexAvailable: boolean;
  copilotAvailable: boolean;
  checkAvailability: () => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set) => ({
  claudeAvailable: false,
  opencodeAvailable: false,
  codexAvailable: false,
  copilotAvailable: false,

  checkAvailability: async () => {
    try {
      const providers = await detectAiProviders();
      const has = (id: string) => providers.some((p) => p.id === id && p.available);
      set({
        claudeAvailable: has('claude'),
        opencodeAvailable: has('opencode'),
        codexAvailable: has('codex'),
        copilotAvailable: has('copilot'),
      });
    } catch {
      set({ claudeAvailable: false, opencodeAvailable: false, codexAvailable: false, copilotAvailable: false });
    }
  },
}));
