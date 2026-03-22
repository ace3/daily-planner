import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from '../components/ui/Toast';
import { isGitWorktree } from '../lib/tauri';

export interface PromptJob {
  id: string;
  queueNumber: number;
  prompt: string;
  projectPath?: string;
  provider?: string;
  isWorktree?: boolean;
  status: 'pending' | 'running' | 'done' | 'error';
  logs: string[];
  createdAt: Date;
  finishedAt?: Date;
}

interface JobLogPayload {
  job_id: string;
  line: string;
}

interface JobDonePayload {
  job_id: string;
  success: boolean;
  exit_code: number;
}

interface PromptQueueState {
  queue: PromptJob[];
  nextQueueNumber: number;
  enqueue: (input: Pick<PromptJob, 'prompt' | 'projectPath' | 'provider'>) => Promise<void>;
  startJob: (id: string) => void;
  appendLog: (id: string, line: string) => void;
  finishJob: (id: string, success: boolean) => void;
  clearDone: () => void;
}

export const usePromptQueueStore = create<PromptQueueState>((set, get) => ({
  queue: [],
  nextQueueNumber: 1,

  enqueue: async (input) => {
    const id = crypto.randomUUID();
    const queueNumber = get().nextQueueNumber;
    const newJob: PromptJob = {
      id,
      queueNumber,
      prompt: input.prompt,
      projectPath: input.projectPath,
      provider: input.provider,
      isWorktree: false,
      status: 'pending',
      logs: [],
      createdAt: new Date(),
    };

    set((state) => ({
      queue: [...state.queue, newJob],
      nextQueueNumber: state.nextQueueNumber + 1,
    }));

    let detectedWorktree = false;
    if (input.projectPath) {
      try {
        detectedWorktree = await isGitWorktree(input.projectPath);
      } catch {
        detectedWorktree = false;
      }
    }

    set((state) => ({
      queue: state.queue.map((job) =>
        job.id === id ? { ...job, isWorktree: detectedWorktree } : job,
      ),
    }));

    const schedulePendingJobs = () => {
      const pendingWorktreeJobs = get().queue.filter(
        (job) => job.status === 'pending' && job.isWorktree,
      );
      for (const job of pendingWorktreeJobs) {
        get().startJob(job.id);
      }

      const hasRunningNonWorktree = get().queue.some(
        (job) => job.status === 'running' && !job.isWorktree,
      );
      if (!hasRunningNonWorktree) {
        const nextNonWorktree = get().queue.find(
          (job) => job.status === 'pending' && !job.isWorktree,
        );
        if (nextNonWorktree) {
          get().startJob(nextNonWorktree.id);
        }
      }
    };

    schedulePendingJobs();
  },

  startJob: (id) => {
    set((state) => ({
      queue: state.queue.map((j) =>
        j.id === id ? { ...j, status: 'running' as const } : j,
      ),
    }));

    const job = get().queue.find((j) => j.id === id);
    if (!job) return;

    invoke<void>('run_prompt', {
      prompt: job.prompt,
      projectPath: job.projectPath,
      provider: job.provider,
      jobId: id,
    }).catch(() => {
      // Tauri IPC failure (not CLI failure — CLI exit is handled via event)
      get().finishJob(id, false);
    });
  },

  appendLog: (id, line) => {
    set((state) => ({
      queue: state.queue.map((j) =>
        j.id === id ? { ...j, logs: [...j.logs, line] } : j,
      ),
    }));
  },

  finishJob: (id, success) => {
    const job = get().queue.find((j) => j.id === id);

    set((state) => ({
      queue: state.queue.map((j) =>
        j.id === id
          ? { ...j, status: success ? 'done' as const : 'error' as const, finishedAt: new Date() }
          : j,
      ),
    }));

    // Notify — only when the window is not in focus
    if (job && !document.hasFocus()) {
      const msg = `Prompt #${job.queueNumber} ${success ? 'finished successfully' : 'failed'}`;
      success ? toast.success(msg) : toast.error(msg);
    }

    const pendingWorktreeJobs = get().queue.filter(
      (queueJob) => queueJob.status === 'pending' && queueJob.isWorktree,
    );
    for (const pendingWorktree of pendingWorktreeJobs) {
      get().startJob(pendingWorktree.id);
    }

    const hasRunningNonWorktree = get().queue.some(
      (queueJob) => queueJob.status === 'running' && !queueJob.isWorktree,
    );
    if (!hasRunningNonWorktree) {
      const nextNonWorktree = get().queue.find(
        (queueJob) => queueJob.status === 'pending' && !queueJob.isWorktree,
      );
      if (nextNonWorktree) {
        get().startJob(nextNonWorktree.id);
      }
    }
  },

  clearDone: () => {
    set((state) => ({
      queue: state.queue.filter((j) => j.status !== 'done' && j.status !== 'error'),
    }));
  },
}));

// Set up Tauri event listeners once when the module is first imported.
// In tests, @tauri-apps/api/event is mocked so this is a safe no-op.
(async () => {
  await listen<JobLogPayload>('prompt_job_log', ({ payload }) => {
    usePromptQueueStore.getState().appendLog(payload.job_id, payload.line);
  });
  await listen<JobDonePayload>('prompt_job_done', ({ payload }) => {
    usePromptQueueStore.getState().finishJob(payload.job_id, payload.success);
  });
})();
