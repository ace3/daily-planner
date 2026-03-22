import { create } from 'zustand';
import type { DailyReport } from '../types/report';
import * as api from '../lib/tauri';

interface ReportState {
  report: DailyReport | null;
  recentReports: DailyReport[];
  loading: boolean;
  error: string | null;
  generateReport: (date: string) => Promise<void>;
  fetchReport: (date: string) => Promise<void>;
  fetchRecentReports: (days: number) => Promise<void>;
  saveReflection: (date: string, reflection: string) => Promise<void>;
}

export const useReportStore = create<ReportState>((set, get) => ({
  report: null,
  recentReports: [],
  loading: false,
  error: null,

  generateReport: async (date) => {
    set({ loading: true, error: null });
    try {
      const report = await api.generateReport(date);
      set({ report, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchReport: async (date) => {
    set({ loading: true, error: null });
    try {
      const report = await api.getReport(date);
      set({ report: report ?? null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchRecentReports: async (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const from = start.toISOString().split('T')[0];
    const to = end.toISOString().split('T')[0];
    try {
      const recentReports = await api.getReportsRange(from, to);
      set({ recentReports });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveReflection: async (date, reflection) => {
    await api.saveAiReflection(date, reflection);
    await get().fetchReport(date);
  },
}));
