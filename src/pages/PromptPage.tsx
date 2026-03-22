import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { MessageSquare, ListOrdered, GitBranch, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { PromptBuilder } from '../components/claude/PromptBuilder';
import { PromptQueue } from '../components/PromptQueue';
import type { TaskContext } from '../components/claude/PromptBuilder';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useProjectStore } from '../stores/projectStore';
import { usePromptQueueStore } from '../stores/promptQueueStore';
import { getLocalDate } from '../lib/time';
import { improvePromptWithClaude, invokeCopilotCli } from '../lib/tauri';
import type { Task } from '../types/task';
import type { Project } from '../types/project';
import { Badge } from '../components/ui/Badge';
import { useSessionDraftState } from '../hooks/useSessionDraftState';

// Per-task improvement state
interface PromptState {
  prompt: string;
  improved: string;
  loading: boolean;
  error: string | null;
}

const defaultPromptState = (): PromptState => ({
  prompt: '',
  improved: '',
  loading: false,
  error: null,
});

function buildImprovementPrompt(userPrompt: string, ctx?: TaskContext): string {
  const lines: string[] = [];

  lines.push('You are a prompt engineering expert specializing in AI coding agents (like Claude Code).');
  lines.push('');
  lines.push('Your job: take a rough prompt and rewrite it into a clear, detailed, actionable prompt ready for an AI coding agent.');
  lines.push('Return ONLY the improved prompt — no explanation, no preamble.');

  if (ctx) {
    lines.push('');
    lines.push('## Task Context');
    lines.push(`- Task: ${ctx.title}`);
    if (ctx.notes) {
      lines.push(`- Notes: ${ctx.notes}`);
    }
    if (ctx.project) {
      lines.push(`- Project: ${ctx.project.name}`);
      lines.push(`- Project path: ${ctx.project.path}`);
    }
  }

  lines.push('');
  lines.push('## Rough Prompt');
  lines.push(userPrompt);
  lines.push('');
  lines.push('## Rewrite the above into a polished Claude Code prompt:');
  lines.push('- State the specific goal and desired outcome clearly');
  lines.push('- Include relevant technical context from the notes');
  if (ctx?.project) {
    lines.push(`- Reference the project at \`${ctx.project.path}\` where relevant`);
  }
  lines.push('- Structure it so the AI agent can act immediately without clarifying questions');

  return lines.join('\n');
}

function buildTaskContext(task: Task, projects: Project[]): TaskContext {
  return {
    title: task.title,
    notes: task.notes,
    project: task.project_id ? projects.find((p) => p.id === task.project_id) : undefined,
  };
}

// Standalone (no task) uses key ''
const STANDALONE_KEY = '';

type Tab = 'builder' | 'queue';

export const PromptPage: React.FC = () => {
  const { tasks, fetchTasks, savePromptResult, updateTaskStatus, activeDate } = useTaskStore();
  const { settings } = useSettingsStore();
  const { projects, fetchProjects } = useProjectStore();
  const queueLength = usePromptQueueStore((s) => s.queue.length);
  const enqueueWithWorktreePipeline = usePromptQueueStore((s) => s.enqueueWithWorktreePipeline);
  const selectedAiProvider = settings?.ai_provider ?? 'claude';
  const [worktreePipelineJobId, setWorktreePipelineJobId] = useState<string | null>(null);
  const [showTestOutput, setShowTestOutput] = useState(false);
  const worktreePipelineJob = usePromptQueueStore((s) =>
    worktreePipelineJobId ? s.queue.find((j) => j.id === worktreePipelineJobId) : null,
  );
  const [activeTab, setActiveTab] = useState<Tab>('builder');
  const runProvider = selectedAiProvider === 'copilot_cli' ? 'claude' : selectedAiProvider;
  const [selectedTaskId, setSelectedTaskId] = useSessionDraftState<string | null>('prompt-page:selected-task-id', null);
  const today = getLocalDate(settings?.timezone_offset ?? 7);

  // Per-task state — keyed by task id ('' = standalone)
  const [promptStates, setPromptStates] = useSessionDraftState<Record<string, PromptState>>('prompt-page:states', {});
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) ?? null : null;

  useEffect(() => {
    if (today !== activeDate) fetchTasks(today);
    fetchProjects();
  }, [today]);

  // Pre-populate state from saved task data when a task is first selected
  useEffect(() => {
    if (!selectedTask) return;
    const key = selectedTask.id;
    setPromptStates((prev) => {
      if (prev[key]) return prev; // already initialized this session, don't overwrite
      if (!selectedTask.prompt_used && !selectedTask.prompt_result) return prev;
      return {
        ...prev,
        [key]: {
          prompt: selectedTask.prompt_used ?? '',
          improved: selectedTask.prompt_result ?? '',
          loading: false,
          error: null,
        },
      };
    });
  }, [selectedTask]);

  const taskKey = selectedTaskId ?? STANDALONE_KEY;
  const state = promptStates[taskKey] ?? defaultPromptState();

  const builtPrompt = useMemo(() => {
    if (!state.prompt.trim()) return '';
    const ctx = selectedTask ? buildTaskContext(selectedTask, projects) : undefined;
    return buildImprovementPrompt(state.prompt, ctx);
  }, [state.prompt, selectedTask, projects]);

  const patchState = useCallback((key: string, patch: Partial<PromptState>) => {
    setPromptStates((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? defaultPromptState()), ...patch },
    }));
  }, []);

  const handlePromptChange = useCallback(
    (value: string) => patchState(taskKey, { prompt: value }),
    [taskKey, patchState],
  );

  const handleImprovedChange = useCallback(
    (value: string) => patchState(taskKey, { improved: value }),
    [taskKey, patchState],
  );

  const handleImprove = useCallback(() => {
    const currentPrompt = (promptStates[taskKey] ?? defaultPromptState()).prompt;
    if (!currentPrompt.trim()) return;

    // Capture at call time — result always applies to the correct task even if user navigates away
    const capturedKey = taskKey;
    const capturedContext = selectedTask ? buildTaskContext(selectedTask, projects) : undefined;
    const capturedPrompt = currentPrompt.trim();
    const capturedProvider = selectedAiProvider;

    patchState(capturedKey, { loading: true, error: null, improved: '' });

    const metaPrompt = buildImprovementPrompt(capturedPrompt, capturedContext);

    const request = capturedProvider === 'copilot_cli'
      ? invokeCopilotCli(metaPrompt, 'suggest', capturedContext?.project?.path)
      : improvePromptWithClaude(metaPrompt, capturedContext?.project?.path, capturedProvider, capturedContext?.project?.id);

    request
      .then((result) => {
        patchState(capturedKey, { improved: result, loading: false });
      })
      .catch((e: unknown) => {
        patchState(capturedKey, { error: String(e), loading: false });
      });
  }, [taskKey, selectedTask, projects, promptStates, patchState, selectedAiProvider]);

  const handleReset = useCallback(() => {
    patchState(taskKey, { improved: '', error: null });
  }, [taskKey, patchState]);

  const handleRunAsWorktree = useCallback(async () => {
    const currentState = promptStates[taskKey] ?? defaultPromptState();
    const promptToRun = currentState.improved || currentState.prompt;
    if (!promptToRun.trim()) return;

    const projectPath = selectedTask?.project_id
      ? projects.find((p) => p.id === selectedTask.project_id)?.path
      : undefined;

    setShowTestOutput(false);
    const jobId = await enqueueWithWorktreePipeline(
      { prompt: promptToRun, projectPath, provider: runProvider },
    );
    setWorktreePipelineJobId(jobId);
  }, [taskKey, promptStates, selectedTask, projects, runProvider, enqueueWithWorktreePipeline]);

  const handleSaveResult = async (prompt: string, result: string) => {
    if (selectedTask) {
      await savePromptResult(selectedTask.id, prompt, result);
    }
  };

  const handleMarkDone = async () => {
    if (!selectedTask) return;
    await updateTaskStatus(selectedTask.id, 'done');
    setSelectedTaskId(null);
  };

  const activeTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'carried_over');

  return (
    <div className="flex-1 overflow-y-auto flex flex-col p-4 gap-4">
      {/* Header + tabs */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-gray-500 dark:text-[#8B949E]" />
          <h1 className="text-base font-semibold text-gray-900 dark:text-[#E6EDF3]">Prompt</h1>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-[#30363D] p-0.5 bg-gray-50 dark:bg-[#0F1117]">
          <button
            onClick={() => setActiveTab('builder')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer
              ${activeTab === 'builder'
                ? 'bg-white dark:bg-[#21262D] text-gray-900 dark:text-[#E6EDF3] shadow-sm'
                : 'text-gray-500 dark:text-[#8B949E] hover:text-gray-700 dark:hover:text-[#E6EDF3]'
              }`}
          >
            <MessageSquare size={12} />
            Builder
          </button>
          <button
            onClick={() => setActiveTab('queue')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer
              ${activeTab === 'queue'
                ? 'bg-white dark:bg-[#21262D] text-gray-900 dark:text-[#E6EDF3] shadow-sm'
                : 'text-gray-500 dark:text-[#8B949E] hover:text-gray-700 dark:hover:text-[#E6EDF3]'
              }`}
          >
            <ListOrdered size={12} />
            Queue
            {queueLength > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-400">
                {queueLength}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Queue tab */}
      {activeTab === 'queue' && (
        <div className="flex-1">
          <PromptQueue />
        </div>
      )}

      {/* Builder tab */}
      {activeTab === 'builder' && (
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* Task context panel */}
        <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-3 overflow-y-auto">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 dark:text-[#8B949E]">
            Link to Task
          </h3>
          <div className="space-y-1.5">
            <button
              onClick={() => setSelectedTaskId(null)}
              className={`w-full text-left p-2 rounded-lg text-xs transition-colors cursor-pointer
                ${!selectedTask ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:text-[#484F58] dark:hover:text-[#8B949E] dark:hover:bg-[#0F1117]'}`}
            >
              No link (standalone)
            </button>
            {activeTasks.map((task) => {
              const taskState = promptStates[task.id];
              const isImproving = taskState?.loading === true;
              return (
                <button
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors cursor-pointer
                    ${selectedTask?.id === task.id
                      ? 'border-blue-500/40 bg-blue-500/10'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-[#30363D] dark:hover:border-[#444C56] dark:hover:bg-[#1C2128]'
                    }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-gray-900 dark:text-[#E6EDF3] truncate flex-1">{task.title}</span>
                    {isImproving && (
                      <span className="shrink-0 w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Improving…" />
                    )}
                  </div>
                  <div className="flex gap-1 mt-0.5">
                    <Badge variant="gray">{task.task_type}</Badge>
                    {task.prompt_used && <Badge variant="blue">has prompt</Badge>}
                    {taskState?.improved && <Badge variant="green">improved</Badge>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Prompt builder */}
        <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4 overflow-y-auto flex flex-col gap-3">
          <PromptBuilder
            taskContext={selectedTask ? buildTaskContext(selectedTask, projects) : undefined}
            onResponseSave={selectedTask ? handleSaveResult : undefined}
            prompt={state.prompt}
            onPromptChange={handlePromptChange}
            improved={state.improved}
            onImprovedChange={handleImprovedChange}
            loading={state.loading}
            error={state.error}
            onImprove={handleImprove}
            onReset={handleReset}
            builtPrompt={builtPrompt}
            onMarkDone={selectedTask ? handleMarkDone : undefined}
            projectPath={selectedTask?.project_id
              ? projects.find((p) => p.id === selectedTask.project_id)?.path
              : undefined}
            provider={runProvider}
            onRunAsWorktree={handleRunAsWorktree}
            worktreeButtonDisabled={
              !state.improved.trim() ||
              (!!worktreePipelineJob &&
              !['merged', 'tests_failed', 'none'].includes(worktreePipelineJob.worktreeStatus))
            }
            worktreeButtonLabel={
              worktreePipelineJob && !['merged', 'tests_failed', 'none'].includes(worktreePipelineJob.worktreeStatus)
                ? 'Running...'
                : 'Run as Worktree'
            }
          />

          {/* Worktree pipeline status panel */}
          {worktreePipelineJob && (
            <div className={`rounded-lg border p-3 text-xs ${
              worktreePipelineJob.worktreeStatus === 'merged'
                ? 'border-green-500/30 bg-green-500/10'
                : worktreePipelineJob.worktreeStatus === 'tests_failed' || worktreePipelineJob.pipelineError
                ? 'border-red-500/30 bg-red-500/10'
                : 'border-purple-500/30 bg-purple-500/10'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <GitBranch size={12} className="text-purple-400 shrink-0" />
                <span className="font-semibold text-purple-300 uppercase tracking-wide">Worktree Pipeline</span>
                {worktreePipelineJob.worktreeStatus === 'merged' && (
                  <CheckCircle2 size={13} className="text-green-400 ml-auto" />
                )}
                {(worktreePipelineJob.worktreeStatus === 'tests_failed' || worktreePipelineJob.pipelineError) &&
                  worktreePipelineJob.worktreeStatus !== 'merged' && (
                  <XCircle size={13} className="text-red-400 ml-auto" />
                )}
                {!['merged', 'tests_failed', 'none'].includes(worktreePipelineJob.worktreeStatus) &&
                  !worktreePipelineJob.pipelineError && (
                  <Loader2 size={13} className="text-purple-400 ml-auto animate-spin" />
                )}
              </div>

              {/* Step indicators */}
              <div className="flex items-center gap-1 flex-wrap text-[11px] mb-2">
                {[
                  { key: 'creating', label: 'Create' },
                  { key: 'ready', label: 'Run' },
                  { key: 'tests_running', label: 'Test' },
                  { key: 'merging', label: 'Merge' },
                  { key: 'merged', label: 'Done' },
                ].map(({ key, label }, i) => {
                  const order = ['creating', 'ready', 'tests_running', 'tests_passed', 'merging', 'merged'];
                  const currentIdx = order.indexOf(worktreePipelineJob.worktreeStatus);
                  const stepIdx = order.indexOf(key === 'ready' ? 'ready' : key);
                  const isDone = currentIdx > stepIdx;
                  const isActive = worktreePipelineJob.worktreeStatus === key ||
                    (key === 'Run' && worktreePipelineJob.status === 'running');
                  return (
                    <React.Fragment key={key}>
                      {i > 0 && <span className="text-gray-600">→</span>}
                      <span className={`px-1.5 py-0.5 rounded ${
                        isDone ? 'text-green-400' :
                        isActive ? 'text-purple-300 font-medium' :
                        'text-gray-600'
                      }`}>
                        {label}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Branch info */}
              {worktreePipelineJob.worktreeBranch && (
                <div className="text-[11px] text-gray-500 mb-1">
                  Branch: <code className="text-gray-400">{worktreePipelineJob.worktreeBranch}</code>
                </div>
              )}

              {/* Test results summary */}
              {worktreePipelineJob.testResults && (
                <div className="text-[11px] mb-1">
                  Tests:{' '}
                  <span className={worktreePipelineJob.testResults.passed ? 'text-green-400' : 'text-red-400'}>
                    {worktreePipelineJob.testResults.passed ? '✓ All passed' : '✗ Failed'}
                  </span>
                  {' '}(Frontend: {worktreePipelineJob.testResults.frontend_passed}✓ {worktreePipelineJob.testResults.frontend_failed}✗,
                  Rust: {worktreePipelineJob.testResults.rust_passed}✓ {worktreePipelineJob.testResults.rust_failed}✗)
                </div>
              )}

              {/* Error message */}
              {worktreePipelineJob.pipelineError && (
                <div className="text-[11px] text-red-400 mb-1">{worktreePipelineJob.pipelineError}</div>
              )}

              {/* Collapsible test output */}
              {worktreePipelineJob.testOutput.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowTestOutput((v) => !v)}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 cursor-pointer"
                  >
                    {showTestOutput ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    {showTestOutput ? 'Hide' : 'Show'} test output ({worktreePipelineJob.testOutput.length} lines)
                  </button>
                  {showTestOutput && (
                    <pre className="mt-1.5 rounded bg-black/40 border border-gray-700 p-2 text-[10px] text-gray-400 font-mono overflow-y-auto max-h-48 whitespace-pre-wrap">
                      {worktreePipelineJob.testOutput.join('\n')}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
