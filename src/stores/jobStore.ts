import { create } from 'zustand';
import type { PromptJob } from '../types/job';
import {
  getActiveJobs,
  getRecentJobs,
  getJobsByTask,
  runTaskPrompt,
  cancelPromptRun,
} from '../lib/tauri';

interface JobStore {
  activeJobs: PromptJob[];
  recentJobs: PromptJob[];
  loading: boolean;
  fetchActiveJobs: () => Promise<void>;
  fetchRecentJobs: () => Promise<void>;
  fetchJobsByTask: (taskId: string) => Promise<PromptJob[]>;
  runPrompt: (taskId: string, prompt?: string, provider?: string) => Promise<string>;
  cancelJob: (jobId: string) => Promise<void>;
}

export const useJobStore = create<JobStore>((set) => ({
  activeJobs: [],
  recentJobs: [],
  loading: false,

  fetchActiveJobs: async () => {
    try {
      const jobs = await getActiveJobs();
      set({ activeJobs: jobs });
    } catch (e) {
      console.error('Failed to fetch active jobs:', e);
    }
  },

  fetchRecentJobs: async () => {
    try {
      const jobs = await getRecentJobs(20);
      set({ recentJobs: jobs });
    } catch (e) {
      console.error('Failed to fetch recent jobs:', e);
    }
  },

  fetchJobsByTask: async (taskId: string) => {
    try {
      return await getJobsByTask(taskId);
    } catch (e) {
      console.error('Failed to fetch jobs for task:', e);
      return [];
    }
  },

  runPrompt: async (taskId: string, prompt?: string, provider?: string) => {
    const jobId = await runTaskPrompt(taskId, prompt, provider);
    // Refresh active jobs after starting a new one
    const jobs = await getActiveJobs();
    set({ activeJobs: jobs });
    return jobId;
  },

  cancelJob: async (jobId: string) => {
    await cancelPromptRun(jobId);
    const jobs = await getActiveJobs();
    set({ activeJobs: jobs });
  },
}));
