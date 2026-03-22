import { create } from 'zustand';
import { checkCliAvailability } from '../lib/tauri';

interface ProviderState {
  claudeAvailable: boolean;
  opencodeAvailable: boolean;
  checkAvailability: () => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set) => ({
  claudeAvailable: false,
  opencodeAvailable: false,

  checkAvailability: async () => {
    try {
      const status = await checkCliAvailability();
      set({ claudeAvailable: status.claude_available, opencodeAvailable: status.opencode_available });
    } catch {
      set({ claudeAvailable: false, opencodeAvailable: false });
    }
  },
}));
