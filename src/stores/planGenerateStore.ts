import { create } from 'zustand';
import { generatePlan } from '../lib/tauri';
import { toast } from '../components/ui/Toast';

export type PlanRunStatus = 'running' | 'completed' | 'failed';

export interface PlanRun {
  id: string;
  taskId: string;
  provider: string;
  startedAt: number;
  finishedAt?: number;
  status: PlanRunStatus;
  plan?: string;
  error?: string;
}

interface StartPlanInput {
  taskId: string;
  taskTitle: string;
  prompt: string;
  projectPath?: string;
  provider: string;
  projectId?: string;
}

interface PlanGenerateState {
  runsByTask: Record<string, PlanRun[]>;
  startPlan: (input: StartPlanInput) => Promise<string>;
}

let runCounter = 0;
function nextRunId(): string {
  runCounter += 1;
  return `plan-${Date.now()}-${runCounter}`;
}

export const usePlanGenerateStore = create<PlanGenerateState>((set) => ({
  runsByTask: {},

  startPlan: async ({ taskId, taskTitle, prompt, projectPath, provider, projectId }) => {
    const runId = nextRunId();
    const startedAt = Date.now();

    set((state) => ({
      runsByTask: {
        ...state.runsByTask,
        [taskId]: [
          ...(state.runsByTask[taskId] ?? []),
          { id: runId, taskId, provider, startedAt, status: 'running' as const },
        ],
      },
    }));

    const updateRun = (patch: Partial<PlanRun>) =>
      set((state) => ({
        runsByTask: {
          ...state.runsByTask,
          [taskId]: (state.runsByTask[taskId] ?? []).map((run) =>
            run.id === runId ? { ...run, ...patch } : run
          ),
        },
      }));

    (async () => {
      try {
        const plan = await generatePlan(taskId, taskTitle, prompt, projectPath, provider, projectId);
        updateRun({ status: 'completed', plan, finishedAt: Date.now() });
        toast.success(`Plan generated (${provider})`);
      } catch (e) {
        const message = String(e);
        updateRun({ status: 'failed', error: message, finishedAt: Date.now() });
        toast.error(`Plan generation failed: ${message}`);
      }
    })();

    return runId;
  },
}));
