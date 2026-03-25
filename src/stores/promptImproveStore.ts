import { create } from 'zustand';
import type { Project } from '../types/project';
import { improvePromptWithClaude, updateTaskPrompt } from '../lib/tauri';
import { buildImprovementPrompt } from '../lib/promptImprover';
import { toast } from '../components/ui/Toast';

export type ImproveRunStatus = 'running' | 'completed' | 'failed';

export interface ImproveRun {
  id: string;
  taskId: string;
  provider: string;
  sourcePrompt: string;
  startedAt: number;
  finishedAt?: number;
  status: ImproveRunStatus;
  improvedPrompt?: string;
  error?: string;
}

interface ImproveTaskContext {
  title: string;
  notes: string;
  taskType: string;
  projectId?: string | null;
  project?: Project;
}

interface StartImproveInput {
  taskId: string;
  prompt: string;
  provider: string;
  projectPath?: string;
  context: ImproveTaskContext;
}

interface PromptImproveState {
  runsByTask: Record<string, ImproveRun[]>;
  startImprove: (input: StartImproveInput) => Promise<string>;
}

let runCounter = 0;
function nextRunId(): string {
  runCounter += 1;
  return `improve-${Date.now()}-${runCounter}`;
}

function appendRun(
  runsByTask: Record<string, ImproveRun[]>,
  taskId: string,
  run: ImproveRun,
): Record<string, ImproveRun[]> {
  return {
    ...runsByTask,
    [taskId]: [...(runsByTask[taskId] ?? []), run],
  };
}

export const usePromptImproveStore = create<PromptImproveState>((set) => ({
  runsByTask: {},

  startImprove: async ({ taskId, prompt, provider, projectPath, context }) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      throw new Error('Prompt is required');
    }

    const runId = nextRunId();
    const startedAt = Date.now();

    set((state) => ({
      runsByTask: appendRun(state.runsByTask, taskId, {
        id: runId,
        taskId,
        provider,
        sourcePrompt: normalizedPrompt,
        startedAt,
        status: 'running',
      }),
    }));

    (async () => {
      try {
        const improveInstruction = buildImprovementPrompt(normalizedPrompt, {
          title: context.title,
          notes: context.notes,
          project: context.project,
        });

        let improved = await improvePromptWithClaude(
          improveInstruction,
          projectPath,
          provider,
          context.projectId ?? undefined,
        );

        // Guardrail: retry once with an explicit correction if model returns execution/progress output.
        const looksLikeExecutionReport =
          /\b(done\.|here'?s what changed|implemented|updated|i changed|completed)\b/i.test(improved);
        if (looksLikeExecutionReport) {
          const retryPrompt = [
            'Rewrite the rough prompt into an execution-ready coding prompt.',
            'Do not execute or summarize implementation.',
            'Output only the rewritten prompt with sections: Objective, Context, Requirements, Acceptance Criteria, Verification.',
            '',
            'Original rough prompt:',
            normalizedPrompt,
            '',
            'Invalid previous output (for correction):',
            improved,
          ].join('\n');
          improved = await improvePromptWithClaude(
            retryPrompt,
            projectPath,
            provider,
            context.projectId ?? undefined,
          );
        }

        const finalImproved = improved.trim();
        await updateTaskPrompt(taskId, normalizedPrompt, finalImproved);

        set((state) => ({
          runsByTask: {
            ...state.runsByTask,
            [taskId]: (state.runsByTask[taskId] ?? []).map((run) =>
              run.id === runId
                ? {
                    ...run,
                    status: 'completed',
                    improvedPrompt: finalImproved,
                    finishedAt: Date.now(),
                  }
                : run
            ),
          },
        }));
        toast.success(`Prompt improvement completed (${provider})`);
      } catch (e) {
        const message = String(e);
        set((state) => ({
          runsByTask: {
            ...state.runsByTask,
            [taskId]: (state.runsByTask[taskId] ?? []).map((run) =>
              run.id === runId
                ? {
                    ...run,
                    status: 'failed',
                    error: message,
                    finishedAt: Date.now(),
                  }
                : run
            ),
          },
        }));
        toast.error(`Prompt improvement failed: ${message}`);
      }
    })();

    return runId;
  },
}));

