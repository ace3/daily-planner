import { create } from 'zustand';

interface SyncState {
  syncing: boolean;
  lastSyncedAt: Date | null;
  syncAll: (
    fetchTasks: (date: string) => Promise<void>,
    activeDate: string,
    fetchSettings: () => Promise<void>,
    fetchProjects: () => Promise<void>,
  ) => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  syncing: false,
  lastSyncedAt: null,

  syncAll: async (fetchTasks, activeDate, fetchSettings, fetchProjects) => {
    if (get().syncing) return;
    set({ syncing: true });
    try {
      await Promise.all([
        fetchTasks(activeDate),
        fetchSettings(),
        fetchProjects(),
      ]);
      set({ lastSyncedAt: new Date() });
    } finally {
      set({ syncing: false });
    }
  },
}));
