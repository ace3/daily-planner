import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from '../components/ui/Toast';
import { isGitWorktree, createPromptWorktree, runTestsInWorktree, mergeWorktreeBranch, cleanupPromptWorktree } from '../lib/tauri';
import { isWebBrowser } from '../lib/http';
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
  /** When true, finishJob auto-runs tests → merge → cleanup pipeline */
  worktreePipeline?: boolean;
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
  /** Error message from any pipeline step failure */
  pipelineError?: string;
}

// Tracks active browser-mode SSE connections by job_id
const browserJobSources = new Map<string, EventSource>();

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
  /** Enqueue a job, create worktree, run prompt → tests → merge → cleanup automatically. Returns job id. */
  enqueueWithWorktreePipeline: (
    input: Pick<PromptJob, 'prompt' | 'projectPath' | 'provider'>,
    baseBranch?: string,
  ) => Promise<string>;
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

    if (isWebBrowser()) {
      // Browser mode: POST to /api/prompt/run and stream SSE response
      const token = localStorage.getItem('vegr-auth-token');
      const base = localStorage.getItem('vegr-server-url') || window.location.origin;
      const url = new URL('/api/prompt/run', base);

      fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: job.prompt,
          project_path: job.projectPath,
          provider: job.provider,
          job_id: id,
        }),
      }).then(async (res) => {
        if (!res.ok || !res.body) {
          get().finishJob(id, false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let eventType = '';
          let dataLine = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLine = line.slice(5).trim();
            } else if (line === '') {
              // Event boundary
              if (eventType === 'line' && dataLine) {
                get().appendLog(id, dataLine);
              } else if (eventType === 'done') {
                try {
                  const payload = JSON.parse(dataLine) as { success: boolean };
                  get().finishJob(id, payload.success);
                } catch {
                  get().finishJob(id, true);
                }
              } else if (eventType === 'error') {
                get().appendLog(id, `Error: ${dataLine}`);
              }
              eventType = '';
              dataLine = '';
            }
          }
        }

        // Stream ended without explicit done event
        const currentJob = get().queue.find((j) => j.id === id);
        if (currentJob && currentJob.status === 'running') {
          get().finishJob(id, true);
        }
      }).catch(() => {
        get().finishJob(id, false);
      });
    } else {
      // Desktop mode: use Tauri invoke
      invoke<void>('run_prompt', {
        prompt: job.prompt,
        projectPath: job.projectPath,
        provider: job.provider,
        jobId: id,
      }).catch(() => {
        // Tauri IPC failure (not CLI failure — CLI exit is handled via event)
        get().finishJob(id, false);
      });
    }
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

    // Notify — only when the window is not in focus (and not a silent pipeline job)
    const updatedJob = get().queue.find((j) => j.id === id);
    if (job && !updatedJob?.worktreePipeline && !document.hasFocus()) {
      const msg = `Prompt #${job.queueNumber} ${success ? 'finished successfully' : 'failed'}`;
      success ? toast.success(msg) : toast.error(msg);
    }

    // Auto-continue worktree pipeline: run tests after prompt completes
    if (updatedJob?.worktreePipeline && updatedJob.worktreePath) {
      if (success) {
        setTimeout(() => get().runTestsForJob(id), 0);
      } else {
        // Prompt step failed — cleanup worktree and surface error
        set((state) => ({
          queue: state.queue.map((j) =>
            j.id === id
              ? { ...j, worktreeStatus: 'tests_failed' as PromptWorktreeStatus, pipelineError: 'Prompt execution failed' }
              : j,
          ),
        }));
        setTimeout(() => get().cleanupWorktreeForJob(id), 0);
      }
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
      set((state) => ({ queue: state.queue.filter((j) => j.id !== id) }));
    } else if (job.status === 'running') {
      if (isWebBrowser()) {
        // In browser mode, just mark as cancelled (no server-side cancellation yet)
        get().finishJob(id, false);
      } else {
        await invoke<void>('cancel_prompt_run', { jobId: id }).catch(() => {});
      }
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

      // Auto-continue pipeline
      const afterTests = get().queue.find((j) => j.id === id);
      if (afterTests?.worktreePipeline) {
        if (result.passed) {
          await get().mergeWorktreeForJob(id, 'main');
          // If merge failed, the status reverts to tests_passed — still cleanup
          const afterMerge = get().queue.find((j) => j.id === id);
          if (afterMerge?.worktreeStatus !== 'merged') {
            const mergeErr = afterMerge?.pipelineError ?? 'Merge failed';
            set((state) => ({
              queue: state.queue.map((j) =>
                j.id === id ? { ...j, pipelineError: mergeErr } : j,
              ),
            }));
            await get().cleanupWorktreeForJob(id);
          }
        } else {
          // Tests failed — cleanup, don't merge
          set((state) => ({
            queue: state.queue.map((j) =>
              j.id === id
                ? { ...j, pipelineError: `Tests failed: ${result.frontend_failed} frontend, ${result.rust_failed} rust` }
                : j,
            ),
          }));
          await get().cleanupWorktreeForJob(id);
        }
      }
    } catch (e) {
      set((state) => ({
        queue: state.queue.map((j) =>
          j.id === id
            ? { ...j, worktreeStatus: 'tests_failed' as PromptWorktreeStatus, pipelineError: String(e) }
            : j,
        ),
      }));
      const isPipeline = get().queue.find((j) => j.id === id)?.worktreePipeline;
      if (!isPipeline) {
        toast.error(`Test run failed: ${String(e)}`);
      }
      // Always cleanup on pipeline failure
      if (isPipeline) {
        await get().cleanupWorktreeForJob(id);
      }
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
        if (!get().queue.find((j) => j.id === id)?.worktreePipeline) {
          toast.success(`Merged into ${targetBranch}`);
        }
        // Auto-cleanup after successful merge
        await get().cleanupWorktreeForJob(id);
      } else {
        set((state) => ({
          queue: state.queue.map((j) =>
            j.id === id
              ? { ...j, worktreeStatus: 'tests_passed' as PromptWorktreeStatus, pipelineError: result.message }
              : j,
          ),
        }));
        if (!get().queue.find((j) => j.id === id)?.worktreePipeline) {
          toast.error(`Merge failed: ${result.message}`);
        }
      }
    } catch (e) {
      set((state) => ({
        queue: state.queue.map((j) =>
          j.id === id
            ? { ...j, worktreeStatus: 'tests_passed' as PromptWorktreeStatus, pipelineError: String(e) }
            : j,
        ),
      }));
      if (!get().queue.find((j) => j.id === id)?.worktreePipeline) {
        toast.error(`Merge error: ${String(e)}`);
      }
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

  enqueueWithWorktreePipeline: async (input, baseBranch) => {
    const id = crypto.randomUUID();
    const queueNumber = get().nextQueueNumber;
    const newJob: PromptJob = {
      id,
      queueNumber,
      prompt: input.prompt,
      projectPath: input.projectPath,
      originalProjectPath: input.projectPath,
      provider: input.provider,
      isWorktree: true,
      worktreePipeline: true,
      status: 'pending',
      improveStep: 'done',
      runStep: 'waiting',
      logs: [],
      createdAt: new Date(),
      worktreeStatus: 'creating',
      testOutput: [],
    };

    set((state) => ({
      queue: [...state.queue, newJob],
      nextQueueNumber: state.nextQueueNumber + 1,
    }));

    // Create worktree + start prompt job; pipeline continues automatically via finishJob
    await get().createWorktreeForJob(id, baseBranch);
    return id;
  },
}));

// Set up event listeners.
// In desktop (Tauri) mode: use Tauri native events.
// In browser mode: SSE is handled per-job in startJob().
if (!isWebBrowser()) {
  (async () => {
    interface JobLogPayload { job_id: string; line: string; }
    interface JobDonePayload { job_id: string; success: boolean; exit_code: number; }
    interface WorktreeTestLogPayload { job_id: string; line: string; }

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
}

// Suppress unused variable warning — browserJobSources is reserved for future
// server-side cancellation support in browser mode.
void browserJobSources;
