import { create } from 'zustand';
import type { AppSettings } from '../types/settings';
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
  loading: boolean;
  error: string | null;
  globalPrompt: string | null;
  fetchSettings: () => Promise<void>;
  updateSetting: (key: keyof AppSettings, value: string) => Promise<void>;
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
  theme: 'dark',
  work_days: [1, 2, 3, 4, 5],
  show_in_tray: true,
  pomodoro_work_min: 25,
  pomodoro_break_min: 5,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  loading: false,
  error: null,
  globalPrompt: null,

  fetchSettings: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await getSettings();
      applyTheme(settings.theme ?? 'dark');
      set({ settings, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updateSetting: async (key, value) => {
    try {
      await setSetting(String(key), value);
      const settings = await getSettings();
      set({ settings });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setTheme: async (theme) => {
    try {
      await setSetting('theme', theme);
      applyTheme(theme);
      const settings = await getSettings();
      set({ settings });
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
