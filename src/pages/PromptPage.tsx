import React, { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { MessageSquare, ListOrdered, Layers, GitBranch, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Copy, Check, X, Terminal, Wand2 } from 'lucide-react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { PromptBuilder } from '../components/claude/PromptBuilder';
import { PromptQueue } from '../components/PromptQueue';
import type { TaskContext } from '../components/claude/PromptBuilder';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useProjectStore } from '../stores/projectStore';
import { usePromptQueueStore } from '../stores/promptQueueStore';
import { getLocalDate } from '../lib/time';
import { improvePromptWithClaude, invokeCopilotCli } from '../lib/tauri';
import { buildImprovementPrompt } from '../lib/promptImprover';
import type { Task } from '../types/task';
import type { Project } from '../types/project';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useSessionDraftState } from '../hooks/useSessionDraftState';
import { generateMasterPrompt, type MergeWarning } from '../lib/masterPromptComposer';

// Per-task improvement state
interface PromptState {
  prompt: string;
  improved: string;
  loading: boolean;
  error: string | null;
  log: string[];
}

const defaultPromptState = (): PromptState => ({
  prompt: '',
  improved: '',
  loading: false,
  error: null,
  log: [],
});

// buildImprovementPrompt is now imported from src/lib/promptImprover.ts

function buildTaskContext(task: Task, projects: Project[]): TaskContext {
  return {
    title: task.title,
    notes: task.notes,
    project: task.project_id ? projects.find((p) => p.id === task.project_id) : undefined,
  };
}

// Standalone (no task) uses key ''
const STANDALONE_KEY = '';

type Tab = 'builder' | 'queue' | 'master';

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
          log: [],
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

  // Ref to hold the unlisten function for log streaming
  const improveUnlistenRef = useRef<UnlistenFn | null>(null);
  const activeImproveRef = useRef<{ requestId: string; key: string } | null>(null);

  const handleImprove = useCallback(() => {
    const currentPrompt = (promptStates[taskKey] ?? defaultPromptState()).prompt;
    if (!currentPrompt.trim()) return;

    // Capture at call time — result always applies to the correct task even if user navigates away
    const capturedKey = taskKey;
    const capturedContext = selectedTask ? buildTaskContext(selectedTask, projects) : undefined;
    const capturedPrompt = currentPrompt.trim();
    const capturedProvider = selectedAiProvider;

    // Generate a unique job_id for log streaming
    const jobId = `improve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requestId = `${capturedKey}-${jobId}`;

    patchState(capturedKey, { loading: true, error: null, improved: '', log: [] });

    // Stop any previous stream listener before starting a new improve request.
    if (improveUnlistenRef.current) {
      improveUnlistenRef.current();
      improveUnlistenRef.current = null;
    }
    activeImproveRef.current = { requestId, key: capturedKey };

    // Subscribe to log events for this job
    listen<{ job_id: string; line: string }>('prompt_job_log', (event) => {
      if (
        event.payload.job_id === jobId &&
        activeImproveRef.current?.requestId === requestId &&
        activeImproveRef.current?.key === capturedKey
      ) {
        setPromptStates((prev) => {
          const current = prev[capturedKey] ?? defaultPromptState();
          return { ...prev, [capturedKey]: { ...current, log: [...current.log, event.payload.line] } };
        });
      }
    }).then((unlisten) => {
      if (activeImproveRef.current?.requestId === requestId) {
        improveUnlistenRef.current = unlisten;
        return;
      }
      unlisten();
    });

    const metaPrompt = buildImprovementPrompt(capturedPrompt, capturedContext);

    const request = capturedProvider === 'copilot_cli'
      ? invokeCopilotCli(metaPrompt, 'suggest', capturedContext?.project?.path)
      : improvePromptWithClaude(metaPrompt, capturedContext?.project?.path, capturedProvider, capturedContext?.project?.id, jobId);

    request
      .then((result) => {
        if (activeImproveRef.current?.requestId !== requestId) return;
        patchState(capturedKey, { improved: result, loading: false });
      })
      .catch((e: unknown) => {
        if (activeImproveRef.current?.requestId !== requestId) return;
        patchState(capturedKey, { error: String(e), loading: false });
      })
      .finally(() => {
        if (activeImproveRef.current?.requestId !== requestId) return;
        // Unsubscribe from log events to prevent leaks
        if (improveUnlistenRef.current) {
          improveUnlistenRef.current();
          improveUnlistenRef.current = null;
        }
        activeImproveRef.current = null;
      });
  }, [taskKey, selectedTask, projects, promptStates, patchState, selectedAiProvider]);

  const handleCancelImprove = useCallback(() => {
    const activeImprove = activeImproveRef.current;
    if (!activeImprove) return;

    if (improveUnlistenRef.current) {
      improveUnlistenRef.current();
      improveUnlistenRef.current = null;
    }
    activeImproveRef.current = null;
    patchState(activeImprove.key, { loading: false, error: 'Improve canceled by user.', log: [] });
  }, [patchState]);

  useEffect(() => {
    return () => {
      if (improveUnlistenRef.current) {
        improveUnlistenRef.current();
      }
      activeImproveRef.current = null;
    };
  }, []);

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
          <button
            onClick={() => setActiveTab('master')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer
              ${activeTab === 'master'
                ? 'bg-white dark:bg-[#21262D] text-gray-900 dark:text-[#E6EDF3] shadow-sm'
                : 'text-gray-500 dark:text-[#8B949E] hover:text-gray-700 dark:hover:text-[#E6EDF3]'
              }`}
          >
            <Layers size={12} />
            Master Prompt
          </button>
        </div>
      </div>

      {/* Master Prompt tab */}
      {activeTab === 'master' && <MasterPromptPanel tasks={tasks} projects={projects} />}

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
            onCancelImprove={handleCancelImprove}
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

          {/* Improve prompt log panel — visible while loading or when log has content and no result yet */}
          {(state.loading || (state.log.length > 0 && !state.improved && !state.error)) && (
            <ImproveLogPanel log={state.log} loading={state.loading} />
          )}

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

// ---------------------------------------------------------------------------
// Improve Log Panel — collapsible panel showing CLI output during improve
// ---------------------------------------------------------------------------
interface ImproveLogPanelProps {
  log: string[];
  loading: boolean;
}

const ImproveLogPanel: React.FC<ImproveLogPanelProps> = ({ log, loading }) => {
  const [expanded, setExpanded] = useState(false);
  const logEndRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (expanded && logEndRef.current) {
      logEndRef.current.scrollTop = logEndRef.current.scrollHeight;
    }
  }, [log.length, expanded]);

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-xs">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left cursor-pointer"
      >
        <Terminal size={12} className="text-blue-400 shrink-0" />
        <span className="font-semibold text-blue-300 uppercase tracking-wide">
          {loading ? 'Improve in progress…' : 'Improve log'}
        </span>
        {loading && <Loader2 size={12} className="text-blue-400 animate-spin" />}
        <span className="ml-auto text-[11px] text-gray-500">
          {log.length} line{log.length !== 1 ? 's' : ''}
        </span>
        {expanded ? <ChevronUp size={11} className="text-gray-500" /> : <ChevronDown size={11} className="text-gray-500" />}
      </button>
      {expanded && log.length > 0 && (
        <pre
          ref={logEndRef}
          className="mt-2 rounded bg-black/40 border border-gray-700 p-2 text-[10px] text-gray-400 font-mono overflow-y-auto max-h-48 whitespace-pre-wrap"
        >
          {log.join('\n')}
        </pre>
      )}
      {expanded && log.length === 0 && loading && (
        <div className="mt-2 text-[11px] text-gray-500">Waiting for output from the CLI…</div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Master Prompt Panel — shown in the "Master Prompt" tab
// ---------------------------------------------------------------------------
interface MasterPromptPanelProps {
  tasks: Task[];
  projects: Project[];
}

// Sentinel key for tasks without a project
const NO_PROJECT_KEY = '__no_project__';

const MasterPromptPanel: React.FC<MasterPromptPanelProps> = ({ tasks, projects }) => {
  const settings = useSettingsStore((state) => state.settings);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [output, setOutput] = useState('');
  const [improvedOutput, setImprovedOutput] = useState('');
  const [warnings, setWarnings] = useState<MergeWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [improveLog, setImproveLog] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [improving, setImproving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyImproved, setCopyImproved] = useState(false);
  const improveUnlistenRef = useRef<UnlistenFn | null>(null);
  const activeImproveRequestRef = useRef<string | null>(null);

  const eligibleTasks = useMemo(
    () =>
      tasks.filter(
        (t) => t.status !== 'done' && typeof t.prompt_result === 'string' && t.prompt_result.trim().length > 0,
      ),
    [tasks],
  );

  // Compute which project groups have eligible tasks
  const projectGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; count: number }> = [];
    const seen = new Set<string>();
    for (const t of eligibleTasks) {
      const key = t.project_id ?? NO_PROJECT_KEY;
      if (seen.has(key)) continue;
      seen.add(key);
      const count = eligibleTasks.filter((x) => (x.project_id ?? NO_PROJECT_KEY) === key).length;
      if (key === NO_PROJECT_KEY) {
        groups.push({ key, label: 'No Project', count });
      } else {
        const p = projects.find((pr) => pr.id === key);
        groups.push({ key, label: p?.name ?? 'Unknown project', count });
      }
    }
    return groups;
  }, [eligibleTasks, projects]);

  // Tasks visible under the current project filter
  const filteredTasks = useMemo(
    () =>
      selectedProjectKey === null
        ? []
        : eligibleTasks.filter(
            (t) => (t.project_id ?? NO_PROJECT_KEY) === selectedProjectKey,
          ),
    [eligibleTasks, selectedProjectKey],
  );

  // Derive projectPath from the selected project for the generated prompt
  const selectedProjectPath = useMemo(() => {
    if (!selectedProjectKey || selectedProjectKey === NO_PROJECT_KEY) return undefined;
    return projects.find((p) => p.id === selectedProjectKey)?.path;
  }, [selectedProjectKey, projects]);

  const handleProjectChange = (key: string) => {
    if (improveUnlistenRef.current) {
      improveUnlistenRef.current();
      improveUnlistenRef.current = null;
    }
    activeImproveRequestRef.current = null;
    setImproving(false);
    setSelectedProjectKey(key);
    setSelectedIds(new Set());
    setOutput('');
    setImprovedOutput('');
    setImproveError(null);
    setImproveLog([]);
    setWarnings([]);
    setError(null);
  };

  const toggleTask = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerate = () => {
    if (improveUnlistenRef.current) {
      improveUnlistenRef.current();
      improveUnlistenRef.current = null;
    }
    activeImproveRequestRef.current = null;
    setImproving(false);
    setImprovedOutput('');
    setImproveError(null);
    setImproveLog([]);
    setCopyImproved(false);
    setGenerating(true);
    setError(null);
    setWarnings([]);
    setOutput('');

    try {
      const sources = filteredTasks
        .filter((t) => selectedIds.has(t.id))
        .map((t) => ({ id: t.id, label: t.title, content: t.prompt_result!, selected: true }));

      const result = generateMasterPrompt(sources);
      setOutput(result.masterPrompt);
      setWarnings(result.warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleImproveWithAi = () => {
    if (!output.trim() || improving) return;

    if (improveUnlistenRef.current) {
      improveUnlistenRef.current();
      improveUnlistenRef.current = null;
    }

    const jobId = `improve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeImproveRequestRef.current = jobId;
    setImproving(true);
    setImproveError(null);
    setImproveLog([]);
    setImprovedOutput('');
    setCopyImproved(false);

    listen<{ job_id: string; line: string }>('prompt_job_log', (event) => {
      if (event.payload.job_id === jobId && activeImproveRequestRef.current === jobId) {
        setImproveLog((prev) => [...prev, event.payload.line]);
      }
    }).then((unlisten) => {
      if (activeImproveRequestRef.current === jobId) {
        improveUnlistenRef.current = unlisten;
        return;
      }
      unlisten();
    });

    const metaPrompt = buildImprovementPrompt(output);
    const provider = settings?.ai_provider ?? 'claude';
    const projectId = selectedProjectKey && selectedProjectKey !== NO_PROJECT_KEY ? selectedProjectKey : undefined;

    improvePromptWithClaude(metaPrompt, selectedProjectPath, provider, projectId, jobId)
      .then((result) => {
        if (activeImproveRequestRef.current !== jobId) return;
        setImprovedOutput(result);
        setImproving(false);
      })
      .catch((e: unknown) => {
        if (activeImproveRequestRef.current !== jobId) return;
        setImproveError(String(e));
        setImproving(false);
      })
      .finally(() => {
        if (activeImproveRequestRef.current !== jobId) return;
        if (improveUnlistenRef.current) {
          improveUnlistenRef.current();
          improveUnlistenRef.current = null;
        }
        activeImproveRequestRef.current = null;
      });
  };

  const handleCancelImprove = () => {
    if (!activeImproveRequestRef.current) return;
    if (improveUnlistenRef.current) {
      improveUnlistenRef.current();
      improveUnlistenRef.current = null;
    }
    activeImproveRequestRef.current = null;
    setImproving(false);
    setImproveError('Improve canceled by user.');
  };

  const handleCopyImproved = async () => {
    if (!improvedOutput) return;
    await navigator.clipboard.writeText(improvedOutput);
    setCopyImproved(true);
    setTimeout(() => setCopyImproved(false), 2000);
  };

  const dismissWarning = (index: number) => {
    setWarnings((prev) => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    return () => {
      if (improveUnlistenRef.current) {
        improveUnlistenRef.current();
      }
    };
  }, []);

  if (eligibleTasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-500 dark:text-[#8B949E]">No tasks with improved prompts yet.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-4">
      {/* Project selector */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">Select Project</h3>
          <p className="text-xs text-gray-500 dark:text-[#8B949E]">
            Choose a project to combine prompts from its tasks.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {projectGroups.map((g) => (
            <button
              key={g.key}
              onClick={() => handleProjectChange(g.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer
                ${selectedProjectKey === g.key
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-400'
                  : 'border-gray-200 dark:border-[#30363D] text-gray-500 dark:text-[#8B949E] hover:bg-gray-50 dark:hover:bg-[#1C2128]'
                }`}
            >
              {g.label} ({g.count})
            </button>
          ))}
        </div>
      </div>

      {/* Task selector — only tasks from selected project */}
      {selectedProjectKey !== null && (
      <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">Select Tasks</h3>
          <p className="text-xs text-gray-500 dark:text-[#8B949E]">
            Pick tasks with saved improved prompts to merge into one master prompt.
          </p>
        </div>

        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {filteredTasks.map((task) => (
              <label
                key={task.id}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors
                  ${selectedIds.has(task.id)
                    ? 'border-blue-500/40 bg-blue-500/10'
                    : 'border-gray-200 dark:border-[#30363D] hover:bg-gray-50 dark:hover:bg-[#1C2128]'
                  }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(task.id)}
                  onChange={() => toggleTask(task.id)}
                  className="h-4 w-4 accent-blue-500 cursor-pointer shrink-0"
                />
                <span className="text-xs font-medium text-gray-900 dark:text-[#E6EDF3] truncate flex-1">
                  {task.title}
                </span>
              </label>
          ))}
        </div>

        {selectedProjectPath && (
          <p className="text-[11px] text-gray-500 dark:text-[#484F58]">
            Project path: <code className="text-gray-400">{selectedProjectPath}</code>
          </p>
        )}

        <Button
          variant="primary"
          size="sm"
          icon={<Layers size={12} />}
          onClick={handleGenerate}
          disabled={selectedIds.size === 0 || generating}
          className="min-w-[200px]"
        >
          {generating ? 'Generating...' : 'Generate Master Prompt'}
        </Button>
      </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300" role="alert">
          {error}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1.5">
          {warnings.map((warning, index) => (
            <div
              key={`${warning.code}-${index}`}
              className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300"
            >
              <span className="flex-1">{warning.message}</span>
              <button
                onClick={() => dismissWarning(index)}
                className="shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-200 cursor-pointer"
                title="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {output && (
        <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-[#8B949E]">
              Master Prompt
            </h3>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<Wand2 size={12} />}
                onClick={handleImproveWithAi}
                disabled={!output || improving}
              >
                {improving ? 'Improving...' : 'Improve with AI'}
              </Button>
              {improving && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleCancelImprove}
                >
                  Cancel Improve
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                onClick={handleCopy}
                className={copied ? 'text-green-400' : ''}
              >
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
          <textarea
            readOnly
            value={output}
            rows={16}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 dark:border-[#30363D] dark:bg-[#0F1117] p-3 text-xs font-mono text-gray-900 dark:text-[#E6EDF3] resize-y outline-none"
          />

          {(improving || (improveLog.length > 0 && !improvedOutput && !improveError)) && (
            <ImproveLogPanel log={improveLog} loading={improving} />
          )}

          {improveError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300" role="alert">
              {improveError}
            </div>
          )}

          {improvedOutput && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-[#8B949E]">
                  Improved Master Prompt
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={copyImproved ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  onClick={handleCopyImproved}
                  className={copyImproved ? 'text-green-400' : ''}
                >
                  {copyImproved ? 'Copied!' : 'Copy improved'}
                </Button>
              </div>
              <textarea
                value={improvedOutput}
                onChange={(event) => setImprovedOutput(event.target.value)}
                rows={16}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 dark:border-[#30363D] dark:bg-[#0F1117] p-3 text-xs font-mono text-gray-900 dark:text-[#E6EDF3] resize-y outline-none"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
