import { create } from 'zustand';
import type { AppSettings } from '../types/settings';
import { getSettings, setSetting, saveClaudeToken } from '../lib/tauri';

interface SettingsState {
  settings: AppSettings | null;
  loading: boolean;
  error: string | null;
  fetchSettings: () => Promise<void>;
  updateSetting: (key: keyof AppSettings, value: string) => Promise<void>;
  updateClaudeToken: (token: string) => Promise<void>;
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
  has_claude_token: false,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  loading: false,
  error: null,

  fetchSettings: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await getSettings();
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

  updateClaudeToken: async (token) => {
    try {
      await saveClaudeToken(token);
      const settings = await getSettings();
      set({ settings });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
