import { create } from 'zustand';
import { checkCliAvailability, checkCopilotCliAvailability, detectAiProviders } from '../lib/tauri';

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
      const [status, copilotStatus, providers] = await Promise.all([
        checkCliAvailability(),
        checkCopilotCliAvailability(),
        detectAiProviders(),
      ]);
      const codexProvider = providers.find((p) => p.id === 'codex');
      set({
        claudeAvailable: status.claude_available,
        opencodeAvailable: status.opencode_available,
        codexAvailable: codexProvider?.available ?? false,
        copilotAvailable: copilotStatus.available,
      });
    } catch {
      set({ claudeAvailable: false, opencodeAvailable: false, codexAvailable: false, copilotAvailable: false });
    }
  },
}));
