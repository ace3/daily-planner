import { create } from 'zustand';
import type { SessionInfo } from '../types/session';
import { getCurrentSessionInfo, type SessionConfig } from '../lib/session';
import { getLocalDate } from '../lib/time';

interface SessionState {
  sessionInfo: SessionInfo | null;
  currentDate: string;
  config: SessionConfig;
  setConfig: (config: SessionConfig) => void;
  tick: () => void;
}

const defaultConfig: SessionConfig = {
  tzOffset: 7,
  session1Kickstart: '09:00',
  planningEnd: '11:00',
  session2Start: '14:00',
  warnBeforeMin: 15,
};

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionInfo: null,
  currentDate: '',
  config: defaultConfig,

  setConfig: (config) => {
    set({ config });
    const sessionInfo = getCurrentSessionInfo(config);
    const currentDate = getLocalDate(config.tzOffset);
    set({ sessionInfo, currentDate });
  },

  tick: () => {
    const { config } = get();
    const sessionInfo = getCurrentSessionInfo(config);
    const currentDate = getLocalDate(config.tzOffset);
    set({ sessionInfo, currentDate });
  },
}));
