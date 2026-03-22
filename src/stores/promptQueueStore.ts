import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from '../components/ui/Toast';
import { isGitWorktree, createPromptWorktree, runTestsInWorktree, mergeWorktreeBranch, cleanupPromptWorktree } from '../lib/tauri';
import type { WorktreeTestResult } from '../types/task';

export type PromptWorktreeStatus = 'none' | 'creating' | 'ready' | 'tests_running' | 'tests_passed' | 'tests_failed' | 'merging' | 'merged';

export type QueueStep = 'waiting' | 'running' | 'done' | 'error';

export interface PromptJob {
  id: string;
  queueNumber: number;
  prompt: string;
  projectPath?: string;
  originalProjectPath?: string;
  provider?: string;
  isWorktree?: boolean;
  status: 'pending' | 'running' | 'done' | 'error';
  improveStep: QueueStep;
  runStep: QueueStep;
  logs: string[];
  createdAt: Date;
  finishedAt?: Date;
  // Worktree lifecycle
  worktreeStatus: PromptWorktreeStatus;
  worktreePath?: string;
  worktreeBranch?: string;
  testResults?: WorktreeTestResult;
  testOutput: string[];
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
  cancelJob: (id: string) => Promise<void>;
  clearDone: () => void;
  // Worktree actions
  createWorktreeForJob: (id: string, baseBranch?: string) => Promise<void>;
  runTestsForJob: (id: string) => Promise<void>;
  mergeWorktreeForJob: (id: string, targetBranch?: string) => Promise<void>;
  cleanupWorktreeForJob: (id: string) => Promise<void>;
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
      originalProjectPath: input.projectPath,
      provider: input.provider,
      isWorktree: false,
      status: 'pending',
      improveStep: 'done',
      runStep: 'waiting',
      logs: [],
      createdAt: new Date(),
      worktreeStatus: 'none',
      testOutput: [],
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
        j.id === id ? { ...j, status: 'running' as const, runStep: 'running' as QueueStep } : j,
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
          ? {
              ...j,
              status: success ? 'done' as const : 'error' as const,
              runStep: (success ? 'done' : 'error') as QueueStep,
              finishedAt: new Date(),
            }
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

  cancelJob: async (id) => {
    const job = get().queue.find((j) => j.id === id);
    if (!job) return;
    if (job.status === 'pending') {
      // Remove from queue before it ever starts
      set((state) => ({ queue: state.queue.filter((j) => j.id !== id) }));
    } else if (job.status === 'running') {
      // Kill the backend process; prompt_job_done event will mark it error/done
      await invoke<void>('cancel_prompt_run', { jobId: id }).catch(() => {});
    }
  },

  clearDone: () => {
    set((state) => ({
      queue: state.queue.filter((j) => j.status !== 'done' && j.status !== 'error'),
    }));
  },

  createWorktreeForJob: async (id, baseBranch) => {
    const job = get().queue.find((j) => j.id === id);
    if (!job || !job.originalProjectPath) return;

    set((state) => ({
      queue: state.queue.map((j) =>
        j.id === id ? { ...j, worktreeStatus: 'creating' as PromptWorktreeStatus } : j,
      ),
    }));

    try {
      const result = await createPromptWorktree(id, job.originalProjectPath, baseBranch);
      set((state) => ({
        queue: state.queue.map((j) =>
          j.id === id
            ? {
                ...j,
                worktreeStatus: 'ready' as PromptWorktreeStatus,
                worktreePath: result.worktree_path,
                worktreeBranch: result.branch_name,
                projectPath: result.worktree_path,
                isWorktree: true,
              }
            : j,
        ),
      }));
      // Start the job in the worktree
      get().startJob(id);
    } catch (e) {
      set((state) => ({
        queue: state.queue.map((j) =>
          j.id === id ? { ...j, worktreeStatus: 'none' as PromptWorktreeStatus } : j,
        ),
      }));
      toast.error(`Failed to create worktree: ${String(e)}`);
    }
  },

  runTestsForJob: async (id) => {
    const job = get().queue.find((j) => j.id === id);
    if (!job?.worktreePath) return;

    set((state) => ({
      queue: state.queue.map((j) =>
        j.id === id
          ? { ...j, worktreeStatus: 'tests_running' as PromptWorktreeStatus, testOutput: [] }
          : j,
      ),
    }));

    try {
      const result = await runTestsInWorktree(job.worktreePath, id);
      set((state) => ({
        queue: state.queue.map((j) =>
          j.id === id
            ? {
                ...j,
                worktreeStatus: (result.passed ? 'tests_passed' : 'tests_failed') as PromptWorktreeStatus,
                testResults: result,
              }
            : j,
        ),
      }));
    } catch (e) {
      set((state) => ({
        queue: state.queue.map((j) =>
          j.id === id
            ? { ...j, worktreeStatus: 'tests_failed' as PromptWorktreeStatus }
            : j,
        ),
      }));
      toast.error(`Test run failed: ${String(e)}`);
    }
  },

  mergeWorktreeForJob: async (id, targetBranch = 'main') => {
    const job = get().queue.find((j) => j.id === id);
    if (!job?.worktreeBranch || !job.originalProjectPath) return;

    set((state) => ({
      queue: state.queue.map((j) =>
        j.id === id ? { ...j, worktreeStatus: 'merging' as PromptWorktreeStatus } : j,
      ),
    }));

    try {
      const result = await mergeWorktreeBranch(job.originalProjectPath, job.worktreeBranch, targetBranch);
      if (result.success) {
        set((state) => ({
          queue: state.queue.map((j) =>
            j.id === id ? { ...j, worktreeStatus: 'merged' as PromptWorktreeStatus } : j,
          ),
        }));
        toast.success(`Merged into ${targetBranch}`);
        // Auto-cleanup after successful merge
        await get().cleanupWorktreeForJob(id);
      } else {
        set((state) => ({
          queue: state.queue.map((j) =>
            j.id === id ? { ...j, worktreeStatus: 'tests_passed' as PromptWorktreeStatus } : j,
          ),
        }));
        toast.error(`Merge failed: ${result.message}`);
      }
    } catch (e) {
      set((state) => ({
        queue: state.queue.map((j) =>
          j.id === id ? { ...j, worktreeStatus: 'tests_passed' as PromptWorktreeStatus } : j,
        ),
      }));
      toast.error(`Merge error: ${String(e)}`);
    }
  },

  cleanupWorktreeForJob: async (id) => {
    const job = get().queue.find((j) => j.id === id);
    if (!job?.worktreePath || !job.worktreeBranch || !job.originalProjectPath) return;

    try {
      await cleanupPromptWorktree(job.originalProjectPath, job.worktreePath, job.worktreeBranch);
    } catch {
      // Cleanup errors are non-fatal
    }
  },
}));

interface WorktreeTestLogPayload {
  job_id: string;
  line: string;
}

// Set up Tauri event listeners once when the module is first imported.
// In tests, @tauri-apps/api/event is mocked so this is a safe no-op.
(async () => {
  await listen<JobLogPayload>('prompt_job_log', ({ payload }) => {
    usePromptQueueStore.getState().appendLog(payload.job_id, payload.line);
  });
  await listen<JobDonePayload>('prompt_job_done', ({ payload }) => {
    usePromptQueueStore.getState().finishJob(payload.job_id, payload.success);
  });
  await listen<WorktreeTestLogPayload>('worktree_test_log', ({ payload }) => {
    usePromptQueueStore.setState((state) => ({
      queue: state.queue.map((j) =>
        j.id === payload.job_id
          ? { ...j, testOutput: [...j.testOutput, payload.line] }
          : j,
      ),
    }));
  });
})();
