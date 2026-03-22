import { create } from 'zustand';
import type { AppSettings, AiProvider, AiProviderId } from '../types/settings';
import { getSettings, setSetting, getGlobalPrompt, setGlobalPrompt } from '../lib/tauri';

// Apply the dark class immediately based on default theme to avoid FOUC
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark');
}

function applyTheme(theme: string) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

interface SettingsState {
  settings: AppSettings | null;
  activeProvider: AiProviderId;
  availableProviders: AiProvider[];
  loading: boolean;
  error: string | null;
  globalPrompt: string | null;
  fetchSettings: () => Promise<void>;
  setAvailableProviders: (providers: AiProvider[]) => void;
  updateSetting: (key: keyof AppSettings, value: string) => Promise<void>;
  setActiveProvider: (id: AiProviderId) => Promise<void>;
  setTheme: (theme: 'dark' | 'light') => Promise<void>;
  fetchGlobalPrompt: () => Promise<void>;
  setGlobalPrompt: (prompt: string) => Promise<void>;
}

const defaultSettings: AppSettings = {
  timezone_offset: 7,
  session1_kickstart: '09:00',
  planning_end: '11:00',
  session2_start: '14:00',
  warn_before_min: 15,
  autostart: false,
  claude_model: 'claude-sonnet-4-6',
  default_model_codex: 'gpt-5.3-codex',
  default_model_claude: 'claude-sonnet-4-6',
  default_model_opencode: 'gpt-4.1',
  default_model_copilot: 'claude-sonnet-4.5',
  active_ai_provider: 'claude',
  ai_provider: 'claude',
  theme: 'dark',
  work_days: [1, 2, 3, 4, 5],
  show_in_tray: true,
};

const providerToLegacyAiProvider: Record<AiProviderId, AppSettings['ai_provider']> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  copilot: 'copilot_cli',
};

const normalizeProvider = (value: string | null | undefined): AiProviderId | null => {
  switch (value) {
    case 'claude':
    case 'codex':
    case 'opencode':
    case 'copilot':
      return value;
    case 'copilot_cli':
      return 'copilot';
    default:
      return null;
  }
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  activeProvider: defaultSettings.active_ai_provider,
  availableProviders: [],
  loading: false,
  error: null,
  globalPrompt: null,

  fetchSettings: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await getSettings();
      const activeProvider = normalizeProvider(settings.active_ai_provider)
        ?? normalizeProvider(settings.ai_provider)
        ?? 'claude';
      applyTheme(settings.theme ?? 'dark');
      set({ settings, activeProvider, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  setAvailableProviders: (providers) => {
    set({ availableProviders: providers });
  },

  updateSetting: async (key, value) => {
    try {
      await setSetting(String(key), value);
      const settings = await getSettings();
      const activeProvider = normalizeProvider(settings.active_ai_provider)
        ?? normalizeProvider(settings.ai_provider)
        ?? 'claude';
      set({ settings, activeProvider });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setActiveProvider: async (id) => {
    try {
      await setSetting('active_ai_provider', id);
      await setSetting('ai_provider', providerToLegacyAiProvider[id]);
      set((state) => ({
        activeProvider: id,
        settings: state.settings
          ? {
              ...state.settings,
              active_ai_provider: id,
              ai_provider: providerToLegacyAiProvider[id],
            }
          : state.settings,
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  setTheme: async (theme) => {
    try {
      await setSetting('theme', theme);
      applyTheme(theme);
      const settings = await getSettings();
      const activeProvider = normalizeProvider(settings.active_ai_provider)
        ?? normalizeProvider(settings.ai_provider)
        ?? 'claude';
      set({ settings, activeProvider });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchGlobalPrompt: async () => {
    try {
      const prompt = await getGlobalPrompt();
      set({ globalPrompt: prompt });
    } catch {
      // Ignore — global prompt is optional
    }
  },

  setGlobalPrompt: async (prompt) => {
    try {
      await setGlobalPrompt(prompt);
      set({ globalPrompt: prompt || null });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
