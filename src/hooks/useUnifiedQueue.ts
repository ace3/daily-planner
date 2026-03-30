import { useMemo } from 'react';
import { usePromptQueueStore, type PromptJob } from '../stores/promptQueueStore';
import { usePromptImproveStore, type ImproveRun } from '../stores/promptImproveStore';
import { usePlanGenerateStore, type PlanRun } from '../stores/planGenerateStore';

export type JobKind = 'prompt' | 'improve' | 'plan';
export type UnifiedStatus = 'pending' | 'running' | 'done' | 'error';

export interface UnifiedJob {
  id: string;
  kind: JobKind;
  status: UnifiedStatus;
  label: string;
  taskId?: string;
  startedAt: number;
  finishedAt?: number;
  promptJob?: PromptJob;
  improveRun?: ImproveRun;
  planRun?: PlanRun;
}

function normalizePromptStatus(status: PromptJob['status']): UnifiedStatus {
  return status; // already matches
}

function normalizeRunStatus(status: 'running' | 'completed' | 'failed'): UnifiedStatus {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'error';
  return 'running';
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

export function useUnifiedQueue() {
  const promptQueue = usePromptQueueStore((s) => s.queue);
  const improveRunsByTask = usePromptImproveStore((s) => s.runsByTask);
  const planRunsByTask = usePlanGenerateStore((s) => s.runsByTask);

  const jobs = useMemo<UnifiedJob[]>(() => {
    const result: UnifiedJob[] = [];

    // Prompt jobs
    for (const job of promptQueue) {
      result.push({
        id: job.id,
        kind: 'prompt',
        status: normalizePromptStatus(job.status),
        label: truncate(job.prompt, 80),
        startedAt: job.createdAt.getTime(),
        finishedAt: job.finishedAt?.getTime(),
        promptJob: job,
      });
    }

    // Improve runs
    for (const [taskId, runs] of Object.entries(improveRunsByTask)) {
      for (const run of runs) {
        result.push({
          id: run.id,
          kind: 'improve',
          status: normalizeRunStatus(run.status),
          label: truncate(run.sourcePrompt, 80),
          taskId,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          improveRun: run,
        });
      }
    }

    // Plan runs
    for (const [taskId, runs] of Object.entries(planRunsByTask)) {
      for (const run of runs) {
        result.push({
          id: run.id,
          kind: 'plan',
          status: normalizeRunStatus(run.status),
          label: `Plan generation`,
          taskId,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          planRun: run,
        });
      }
    }

    // Sort newest first
    result.sort((a, b) => b.startedAt - a.startedAt);
    return result;
  }, [promptQueue, improveRunsByTask, planRunsByTask]);

  const counts = useMemo(() => {
    let running = 0;
    let done = 0;
    let error = 0;
    for (const j of jobs) {
      if (j.status === 'running') running++;
      else if (j.status === 'done') done++;
      else if (j.status === 'error') error++;
    }
    return { total: jobs.length, running, done, error };
  }, [jobs]);

  return { jobs, counts };
}
