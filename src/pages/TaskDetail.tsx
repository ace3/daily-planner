import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Play, Sparkles, Copy, Check, Loader2,
  ChevronDown, ChevronUp, Terminal, GitBranch, RotateCcw,
  Clock, AlertCircle, GitCommit, Send, Pencil, FileText,
} from 'lucide-react';
import { useMobileStore } from '../stores/mobileStore';
import { useProjectStore } from '../stores/projectStore';
import { usePromptImproveStore, type ImproveRun } from '../stores/promptImproveStore';
import type { Task, TaskType, TaskPriority } from '../types/task';
import type { PromptJob } from '../types/job';
import {
  getTask,
  updateTask,
  updateTaskStatus,
  updateTaskPrompt,
  runTaskPrompt,
  generatePlan,
  reviewTask,
  approveTaskReview,
  fixFromReview,
  cancelPromptRun,
  getJobsByTask,
  gitDiff as fetchGitDiff,
  gitStageAll,
  gitCommit,
  gitPush,
} from '../lib/tauri';
import { ReviewPanel } from '../components/ReviewPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColors(status: string): string {
  switch (status) {
    case 'done': return 'bg-green-500/20 text-green-400';
    case 'review': return 'bg-green-500/20 text-green-400';
    case 'in_progress': return 'bg-blue-500/20 text-blue-400';
    case 'planned': return 'bg-cyan-500/20 text-cyan-400';
    case 'improved': return 'bg-purple-500/20 text-purple-400';
    case 'skipped': return 'bg-gray-500/20 text-gray-400';
    case 'carried_over': return 'bg-orange-500/20 text-orange-400';
    default: return 'bg-yellow-500/20 text-yellow-400'; // todo
  }
}

function jobStatusColors(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'running': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'queued': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'cancelled': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function priorityLabel(p: TaskPriority): string {
  return p === 1 ? 'High' : p === 2 ? 'Medium' : 'Low';
}

function priorityColors(p: TaskPriority): string {
  return p === 1
    ? 'bg-red-500/20 text-red-400'
    : p === 2
    ? 'bg-yellow-500/20 text-yellow-400'
    : 'bg-gray-500/20 text-gray-400';
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Render a git diff string with colored lines
function DiffViewer({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="text-xs dark:text-gray-500 italic">No changes detected.</p>;
  return (
    <pre className="text-xs font-mono overflow-x-auto leading-5">
      {diff.split('\n').map((line, i) => {
        let cls = 'dark:text-gray-400';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-green-400';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-400';
        else if (line.startsWith('@@')) cls = 'text-blue-400';
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) cls = 'dark:text-gray-500';
        return (
          <span key={i} className={`block ${cls}`}>{line || '\u00A0'}</span>
        );
      })}
    </pre>
  );
}

const EMPTY_RUNS: ImproveRun[] = [];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TaskDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { mobileMode: m } = useMobileStore();
  const { projects } = useProjectStore();
  const startImprove = usePromptImproveStore((s) => s.startImprove);
  const improveRunsRaw = usePromptImproveStore((s) => (id ? s.runsByTask[id] : undefined));
  const improveRuns = improveRunsRaw ?? EMPTY_RUNS;

  // Task state
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Editable metadata
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editType, setEditType] = useState<TaskType>('other');
  const [editPriority, setEditPriority] = useState<TaskPriority>(2);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaSaved, setMetaSaved] = useState(false);

  // Prompt state
  const [rawPrompt, setRawPrompt] = useState('');
  const [improvedPrompt, setImprovedPrompt] = useState('');
  const [editingImproved, setEditingImproved] = useState(false);
  const [copiedImproved, setCopiedImproved] = useState(false);
  const [provider, setProvider] = useState('claude');
  const [running, setRunning] = useState(false);

  // Jobs
  const [jobs, setJobs] = useState<PromptJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<PromptJob | null>(null);
  const [showJobHistory, setShowJobHistory] = useState(false);

  // Git
  const [gitDiff, setGitDiff] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Commit/push
  const [commitMsg, setCommitMsg] = useState('');
  const [showCommit, setShowCommit] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [gitActionMsg, setGitActionMsg] = useState('');

  // Plan
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // Review
  const [reviewing, setReviewing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Copy output
  const [copied, setCopied] = useState(false);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------------------------------------------------------------
  // Load task
  // ---------------------------------------------------------------------------
  const loadTask = useCallback(async () => {
    if (!id) return;
    try {
      setLoadError(null);
      const found = await getTask(id);
      console.log('[TaskDetail] getTask result:', found ? `id=${found.id} title="${found.title}"` : 'null');
      setTask(found);
      if (found) {
        setEditTitle(found.title);
        setEditNotes(found.notes ?? '');
        setEditType(found.task_type);
        setEditPriority(found.priority);
        setRawPrompt(found.raw_prompt ?? '');
        setImprovedPrompt(found.improved_prompt ?? '');
        if (found.provider) setProvider(found.provider);
      } else {
        setLoadError(`Task with id "${id}" not found`);
      }
    } catch (e) {
      console.error('Failed to load task:', e);
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Load jobs for this task
  const loadJobs = useCallback(async () => {
    if (!id) return;
    try {
      const j = await getJobsByTask(id);
      // Newest first
      j.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setJobs(j);
      // Auto-select most recent job for output display
      if (j.length > 0) setSelectedJob(j[0]);
    } catch (e) {
      console.error('Failed to load jobs:', e);
    }
  }, [id]);

  useEffect(() => {
    loadTask();
    loadJobs();
  }, [loadTask, loadJobs]);

  // Poll while a job is active
  useEffect(() => {
    const isActive = task?.job_status === 'running' || task?.job_status === 'queued';
    if (isActive) {
      pollRef.current = setInterval(async () => {
        await loadTask();
        await loadJobs();
      }, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [task?.job_status, loadTask, loadJobs]);

  // ---------------------------------------------------------------------------
  // Metadata save
  // ---------------------------------------------------------------------------
  const handleSaveMeta = async () => {
    if (!task) return;
    setSavingMeta(true);
    try {
      await updateTask({
        id: task.id,
        title: editTitle,
        notes: editNotes,
        task_type: editType,
        priority: editPriority,
      });
      setMetaSaved(true);
      setTimeout(() => setMetaSaved(false), 2000);
      await loadTask();
    } catch (e) {
      console.error('Save meta failed:', e);
    } finally {
      setSavingMeta(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Prompt auto-save on blur
  // ---------------------------------------------------------------------------
  const handleRawBlur = async () => {
    if (!task) return;
    try {
      await updateTaskPrompt(task.id, rawPrompt, undefined);
    } catch (e) {
      console.error('Auto-save raw prompt failed:', e);
    }
  };

  const handleUseTitleAsPrompt = async () => {
    if (!task) return;
    const parts = [editTitle.trim()];
    if (editNotes.trim()) parts.push(editNotes.trim());
    const prompt = parts.join('\n\n');
    setRawPrompt(prompt);
    try {
      await updateTaskPrompt(task.id, prompt, undefined);
    } catch (e) {
      console.error('Failed to save prompt:', e);
    }
  };

  // ---------------------------------------------------------------------------
  // Improve with AI
  // ---------------------------------------------------------------------------
  const handleImprove = async () => {
    if (!rawPrompt.trim() || !task) return;
    try {
      const project = projects.find((p) => p.id === task.project_id);
      await startImprove({
        taskId: task.id,
        prompt: rawPrompt,
        provider,
        projectPath: project?.path,
        context: {
          title: editTitle,
          notes: editNotes,
          taskType: editType,
          projectId: task.project_id,
          project,
        },
      });
    } catch (e) {
      console.error('Improve failed:', e);
    }
  };

  // ---------------------------------------------------------------------------
  // Generate plan
  // ---------------------------------------------------------------------------
  const handleGeneratePlan = async () => {
    if (!task) return;
    const promptToUse = improvedPrompt.trim() || rawPrompt.trim();
    if (!promptToUse) return;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const project = projects.find((p) => p.id === task.project_id);
      await generatePlan(task.id, task.title, promptToUse, project?.path, provider, task.project_id ?? undefined);
      await loadTask();
    } catch (e) {
      setPlanError(String(e));
    } finally {
      setPlanLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Review handlers
  // ---------------------------------------------------------------------------
  const handleRequestReview = async () => {
    if (!task) return;
    setReviewing(true);
    setReviewError(null);
    try {
      await reviewTask(task.id, provider);
      await loadTask();
    } catch (e) {
      setReviewError(String(e));
    } finally {
      setReviewing(false);
    }
  };

  const handleApprove = async () => {
    if (!task) return;
    setApproving(true);
    setReviewError(null);
    try {
      await approveTaskReview(task.id);
      await loadTask();
    } catch (e) {
      setReviewError(String(e));
    } finally {
      setApproving(false);
    }
  };

  const handleFixFromReview = async () => {
    if (!task) return;
    setFixing(true);
    setReviewError(null);
    try {
      const project = projects.find((p) => p.id === task.project_id);
      await fixFromReview(task.id, provider, project?.path);
      await loadTask();
      await loadJobs();
    } catch (e) {
      setReviewError(String(e));
    } finally {
      setFixing(false);
    }
  };

  const improvingRuns = improveRuns.filter((run) => run.status === 'running');
  const latestCompletedImprove = [...improveRuns]
    .filter((run) => run.status === 'completed' && !!run.improvedPrompt)
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
  const latestFailedImprove = [...improveRuns]
    .filter((run) => run.status === 'failed')
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];

  useEffect(() => {
    if (!latestCompletedImprove?.improvedPrompt) return;
    setImprovedPrompt(latestCompletedImprove.improvedPrompt);
    setEditingImproved(false);
    loadTask();
  }, [latestCompletedImprove?.id, latestCompletedImprove?.improvedPrompt, loadTask]);

  // ---------------------------------------------------------------------------
  // Run prompt
  // ---------------------------------------------------------------------------
  const handleRun = async () => {
    if (!task) return;
    const promptToRun = improvedPrompt.trim() || rawPrompt.trim();
    if (!promptToRun) return;
    setRunning(true);
    try {
      await runTaskPrompt(task.id, promptToRun, provider);
      await loadTask();
      await loadJobs();
    } catch (e) {
      console.error('Run failed:', e);
    } finally {
      setRunning(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Cancel running job
  // ---------------------------------------------------------------------------
  const handleCancel = async () => {
    if (!task?.job_id) return;
    try {
      await cancelPromptRun(task.job_id);
      await loadTask();
      await loadJobs();
    } catch (e) {
      console.error('Cancel failed:', e);
    }
  };

  // ---------------------------------------------------------------------------
  // Git diff
  // ---------------------------------------------------------------------------
  const getProjectPath = (): string | undefined => {
    if (!task?.project_id) return undefined;
    return projects.find((p) => p.id === task.project_id)?.path;
  };

  const handleLoadDiff = async () => {
    const projectPath = getProjectPath();
    if (!projectPath) return;
    setLoadingDiff(true);
    try {
      const diff = await fetchGitDiff(projectPath);
      setGitDiff(diff);
      setShowDiff(true);
    } catch (e) {
      console.error('Git diff failed:', e);
    } finally {
      setLoadingDiff(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Commit
  // ---------------------------------------------------------------------------
  const handleCommit = async () => {
    const projectPath = getProjectPath();
    if (!projectPath || !commitMsg.trim()) return;
    setCommitting(true);
    setGitActionMsg('');
    try {
      await gitStageAll(projectPath);
      await gitCommit(projectPath, commitMsg.trim());
      setGitActionMsg('Committed successfully.');
      setCommitMsg('');
      setShowCommit(false);
      setGitDiff('');
      setShowDiff(false);
    } catch (e) {
      setGitActionMsg(`Error: ${e}`);
    } finally {
      setCommitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------------------
  const handlePush = async () => {
    const projectPath = getProjectPath();
    if (!projectPath) return;
    setPushing(true);
    setGitActionMsg('');
    try {
      await gitPush(projectPath);
      setGitActionMsg('Pushed successfully.');
    } catch (e) {
      setGitActionMsg(`Error: ${e}`);
    } finally {
      setPushing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Copy output
  // ---------------------------------------------------------------------------
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full dark:text-gray-500">
        <Loader2 size={24} className="animate-spin mr-2" /> Loading task...
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 dark:text-gray-500">
        <AlertCircle size={32} />
        <p>Task not found.</p>
        {loadError && <p className="text-xs text-red-400 max-w-md text-center">{loadError}</p>}
        <button onClick={() => navigate(-1)} className="text-blue-400 hover:underline min-h-[44px]">Go back</button>
      </div>
    );
  }

  const project = projects.find((p) => p.id === task.project_id);
  const isJobActive = task.job_status === 'running' || task.job_status === 'queued';
  const latestOutput = selectedJob?.output ?? task.prompt_output ?? '';
  const hasOutput = !!latestOutput;
  const hasPromptContent = rawPrompt.trim().length > 0 || improvedPrompt.trim().length > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      onClick={() => navigate(-1)}
      className={`${m ? 'p-2' : 'p-6'} overflow-y-auto h-full dark:bg-[#0F1117]/80`}
      data-scrollable
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${m ? 'p-2' : 'max-w-4xl mx-auto'} space-y-4`}
      >
        {/* ------------------------------------------------------------------ */}
        {/* Header                                                               */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg dark:hover:bg-[#21262D] min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 mt-0.5"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className={`font-bold ${m ? 'text-lg' : 'text-xl'} dark:text-[#E6EDF3]`}>{task.title}</h1>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors(task.status)}`}>
                {task.status.replace('_', ' ')}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${priorityColors(task.priority)}`}>
                {priorityLabel(task.priority)}
              </span>
            </div>
            {project && (
              <button
                onClick={() => navigate(`/projects/${project.id}`)}
                className="flex items-center gap-1 text-sm dark:text-blue-400 hover:underline mt-0.5"
              >
                <GitBranch size={12} />
                {project.name}
              </button>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Task Metadata                                                        */}
        {/* ------------------------------------------------------------------ */}
        <div className="dark:bg-[#161B22] rounded-xl p-4 space-y-3 border dark:border-[#30363D]">
        <h3 className="font-semibold dark:text-[#E6EDF3] text-sm uppercase tracking-wide">Task Details</h3>

        {/* Title */}
        <div>
          <label className="text-xs dark:text-gray-500 mb-1 block">Title</label>
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-lg dark:bg-[#0D1117] dark:text-[#E6EDF3] dark:border-[#30363D] border text-sm min-h-[44px]"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs dark:text-gray-500 mb-1 block">Notes</label>
          <textarea
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg dark:bg-[#0D1117] dark:text-[#E6EDF3] dark:border-[#30363D] border text-sm resize-y"
          />
        </div>

        {/* Type + Priority row */}
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs dark:text-gray-500 mb-1 block">Type</label>
            <select
              value={editType}
              onChange={(e) => setEditType(e.target.value as TaskType)}
              className="w-full px-3 py-2 rounded-lg dark:bg-[#0D1117] dark:text-[#E6EDF3] dark:border-[#30363D] border text-sm min-h-[44px]"
            >
              <option value="prompt">Prompt</option>
              <option value="research">Research</option>
              <option value="meeting">Meeting</option>
              <option value="review">Done</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs dark:text-gray-500 mb-1 block">Priority</label>
            <select
              value={editPriority}
              onChange={(e) => setEditPriority(Number(e.target.value) as TaskPriority)}
              className="w-full px-3 py-2 rounded-lg dark:bg-[#0D1117] dark:text-[#E6EDF3] dark:border-[#30363D] border text-sm min-h-[44px]"
            >
              <option value={1}>High</option>
              <option value={2}>Medium</option>
              <option value={3}>Low</option>
            </select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs dark:text-gray-500 mb-1 block">Status</label>
            <select
              value={task.status}
              onChange={async (e) => {
                try {
                  await updateTaskStatus(task.id, e.target.value);
                  await loadTask();
                } catch (err) {
                  console.error('Status update failed:', err);
                }
              }}
              className="w-full px-3 py-2 rounded-lg dark:bg-[#0D1117] dark:text-[#E6EDF3] dark:border-[#30363D] border text-sm min-h-[44px]"
            >
              <option value="todo">To Do</option>
              <option value="improved">Improved</option>
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="review">Review</option>
              <option value="done">Done</option>
              <option value="skipped">Skipped</option>
              <option value="carried_over">Carried Over</option>
            </select>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveMeta}
            disabled={savingMeta}
            className="flex items-center gap-2 px-4 py-2 rounded-lg dark:bg-[#21262D] dark:hover:bg-[#30363D] disabled:opacity-50 text-sm min-h-[44px] font-medium"
          >
            {savingMeta ? (
              <Loader2 size={14} className="animate-spin" />
            ) : metaSaved ? (
              <Check size={14} className="text-green-400" />
            ) : null}
            {metaSaved ? 'Saved!' : 'Save Changes'}
          </button>
          <button
            onClick={handleUseTitleAsPrompt}
            className="flex items-center gap-2 px-4 py-2 rounded-lg dark:bg-[#21262D] dark:hover:bg-[#30363D] text-sm min-h-[44px] font-medium dark:text-blue-400 hover:dark:text-blue-300"
          >
            <FileText size={14} />
            Use Title as Prompt
          </button>
        </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Prompt Section                                                       */}
        {/* ------------------------------------------------------------------ */}
        <div className="dark:bg-[#161B22] rounded-xl p-4 space-y-3 border dark:border-[#30363D]">
        <h3 className="font-semibold dark:text-[#E6EDF3] flex items-center gap-2">
          <Terminal size={16} /> Prompt
        </h3>

        {/* Raw prompt textarea */}
        <div>
          <label className="text-xs dark:text-gray-500 mb-1 block">Your Prompt</label>
          <textarea
            value={rawPrompt}
            onChange={(e) => setRawPrompt(e.target.value)}
            onBlur={handleRawBlur}
            placeholder="Describe what you want to build, fix, or change..."
            className={`w-full ${m ? 'min-h-[120px]' : 'min-h-[150px]'} p-3 rounded-lg dark:bg-[#0D1117] dark:text-[#E6EDF3] dark:border-[#30363D] border resize-y text-sm font-mono`}
          />
        </div>

        {/* Controls row: Improve + Generate Plan + Provider */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleImprove}
            disabled={!rawPrompt.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg dark:bg-purple-700 hover:dark:bg-purple-600 disabled:opacity-50 text-white text-sm min-h-[44px]"
          >
            {improvingRuns.length > 0 ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {improvingRuns.length > 0 ? `Improving (${improvingRuns.length})...` : 'Improve with AI'}
          </button>

          <button
            onClick={handleGeneratePlan}
            disabled={planLoading || (!rawPrompt.trim() && !improvedPrompt.trim())}
            className="flex items-center gap-2 px-4 py-2 rounded-lg dark:bg-cyan-700 hover:dark:bg-cyan-600 disabled:opacity-50 text-white text-sm min-h-[44px]"
          >
            {planLoading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            {planLoading ? 'Planning...' : 'Generate Plan'}
          </button>

          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="px-3 py-2 rounded-lg dark:bg-[#0D1117] dark:text-[#E6EDF3] dark:border-[#30363D] border text-sm min-h-[44px]"
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
            <option value="opencode">OpenCode</option>
            <option value="copilot">Copilot</option>
          </select>
        </div>
        {improvingRuns.length > 0 && (
          <div className="text-xs dark:text-blue-400">
            {improvingRuns.length} improvement process{improvingRuns.length > 1 ? 'es' : ''} running in background.
          </div>
        )}
        {latestFailedImprove?.error && (
          <div className="text-xs text-red-400 dark:text-red-400 whitespace-pre-wrap">
            Improve failed: {latestFailedImprove.error}
          </div>
        )}

        {/* Improved prompt display */}
        {improvedPrompt && (
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs dark:text-gray-500 uppercase tracking-wide font-medium">Improved Prompt</span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(improvedPrompt);
                    setCopiedImproved(true);
                    setTimeout(() => setCopiedImproved(false), 2000);
                  }}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded dark:bg-[#21262D] dark:hover:bg-[#30363D] min-h-[32px]"
                >
                  {copiedImproved ? <><Check size={12} className="text-emerald-400" /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
                <button
                  onClick={() => setEditingImproved((v) => !v)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded dark:bg-[#21262D] dark:hover:bg-[#30363D] min-h-[32px]"
                >
                  <Pencil size={12} /> {editingImproved ? 'Done' : 'Edit'}
                </button>
                <button
                  onClick={() => {
                    setRawPrompt(improvedPrompt);
                    setImprovedPrompt('');
                    setEditingImproved(false);
                  }}
                  className="text-xs px-2 py-1 rounded dark:bg-blue-600 hover:dark:bg-blue-500 text-white min-h-[32px]"
                >
                  Use this version
                </button>
              </div>
            </div>
            {editingImproved ? (
              <textarea
                value={improvedPrompt}
                onChange={(e) => setImprovedPrompt(e.target.value)}
                onBlur={async () => {
                  if (task) await updateTaskPrompt(task.id, rawPrompt, improvedPrompt).catch(console.error);
                }}
                className="w-full min-h-[120px] p-3 rounded-lg dark:bg-[#0D1117] dark:text-[#E6EDF3] dark:border-[#30363D] border resize-y text-sm font-mono"
              />
            ) : (
              <pre className="p-3 rounded-lg dark:bg-[#0D1117] text-sm font-mono dark:text-[#E6EDF3] whitespace-pre-wrap max-h-[200px] overflow-y-auto border dark:border-[#30363D]">
                {improvedPrompt}
              </pre>
            )}
          </div>
        )}

        {/* Plan error */}
        {planError && (
          <div className="text-xs text-red-400 whitespace-pre-wrap">Plan failed: {planError}</div>
        )}

        {/* Plan display */}
        {task.plan && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs dark:text-gray-500 uppercase tracking-wide font-medium">Execution Plan</span>
              <button
                onClick={() => navigator.clipboard.writeText(task.plan ?? '')}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded dark:bg-[#21262D] dark:hover:bg-[#30363D] min-h-[32px]"
              >
                <Copy size={12} /> Copy
              </button>
            </div>
            <pre className="p-3 rounded-lg dark:bg-[#0D1117] text-xs font-mono dark:text-[#E6EDF3] whitespace-pre-wrap max-h-[300px] overflow-y-auto border dark:border-[#30363D] leading-5">
              {task.plan}
            </pre>
          </div>
        )}

        {/* Run / Cancel button */}
        <div className="flex gap-2">
          <button
            onClick={isJobActive ? handleCancel : handleRun}
            disabled={(running || (!isJobActive && !hasPromptContent))}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-white font-semibold min-h-[48px] transition-colors ${
              isJobActive
                ? 'dark:bg-red-700 dark:hover:bg-red-600'
                : 'dark:bg-green-700 dark:hover:bg-green-600'
            } disabled:opacity-50`}
          >
            {isJobActive ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                {task.job_status === 'queued' ? 'Queued — Cancel' : 'Running — Cancel'}
              </>
            ) : running ? (
              <><Loader2 size={20} className="animate-spin" /> Starting...</>
            ) : (
              <><Play size={20} /> Run Prompt</>
            )}
          </button>
        </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Output Section                                                       */}
        {/* ------------------------------------------------------------------ */}
        {(hasOutput || isJobActive) && (
          <div className="dark:bg-[#161B22] rounded-xl p-4 space-y-3 border dark:border-[#30363D]">
          {/* Job status banner */}
          {selectedJob && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${jobStatusColors(selectedJob.status)}`}>
              {(selectedJob.status === 'running' || selectedJob.status === 'queued') && (
                <Loader2 size={14} className="animate-spin" />
              )}
              <span className="capitalize">{selectedJob.status}</span>
              <span className="dark:text-gray-500 font-normal ml-auto">
                {selectedJob.provider} · {formatDuration(selectedJob.started_at, selectedJob.finished_at)}
              </span>
            </div>
          )}
          {selectedJob?.error_message && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <pre className="whitespace-pre-wrap font-mono text-xs">{selectedJob.error_message}</pre>
            </div>
          )}

          {/* Terminal output */}
          {latestOutput && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs dark:text-gray-500 uppercase tracking-wide">Output</span>
                <button
                  onClick={() => handleCopy(latestOutput)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded dark:bg-[#21262D] dark:hover:bg-[#30363D] min-h-[32px]"
                >
                  {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="p-3 rounded-lg dark:bg-[#0D1117] text-xs font-mono dark:text-[#E6EDF3] whitespace-pre-wrap max-h-[400px] overflow-y-auto border dark:border-[#30363D] leading-5">
                {latestOutput}
              </pre>
            </div>
          )}

          {/* Git diff (only if project linked) */}
          {project && (
            <div>
              <button
                onClick={() => {
                  if (!showDiff) handleLoadDiff();
                  else setShowDiff(false);
                }}
                className="flex items-center gap-2 text-sm dark:text-gray-400 hover:dark:text-gray-200 min-h-[44px] w-full text-left"
              >
                {loadingDiff ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : showDiff ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
                <GitBranch size={14} />
                Git Diff
              </button>
              {showDiff && (
                <div className="mt-2 p-3 rounded-lg dark:bg-[#0D1117] border dark:border-[#30363D] max-h-[300px] overflow-y-auto">
                  <DiffViewer diff={gitDiff} />
                </div>
              )}
            </div>
          )}

          {/* Commit / Push actions */}
          {project && (
            <div className="space-y-2">
              {gitActionMsg && (
                <p className={`text-xs px-3 py-2 rounded-lg ${gitActionMsg.startsWith('Error') || gitActionMsg.includes('failed') ? 'dark:bg-red-500/10 text-red-400' : 'dark:bg-green-500/10 text-green-400'}`}>
                  {gitActionMsg}
                </p>
              )}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setShowCommit((v) => !v)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg dark:bg-[#21262D] dark:hover:bg-[#30363D] text-sm min-h-[44px]"
                >
                  <GitCommit size={14} /> Commit
                </button>
                <button
                  onClick={handlePush}
                  disabled={pushing}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg dark:bg-[#21262D] dark:hover:bg-[#30363D] text-sm min-h-[44px] disabled:opacity-50"
                >
                  {pushing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Push
                </button>
                <button
                  onClick={() => {
                    setSelectedJob(null);
                    setShowDiff(false);
                    setGitDiff('');
                    setGitActionMsg('');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg dark:bg-[#21262D] dark:hover:bg-[#30363D] text-sm min-h-[44px]"
                >
                  <RotateCcw size={14} /> Re-run
                </button>
              </div>
              {showCommit && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder="Commit message..."
                    className="flex-1 px-3 py-2 rounded-lg dark:bg-[#0D1117] dark:text-[#E6EDF3] dark:border-[#30363D] border text-sm min-h-[44px]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCommit(); }
                    }}
                  />
                  <button
                    onClick={handleCommit}
                    disabled={committing || !commitMsg.trim()}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg dark:bg-green-700 dark:hover:bg-green-600 text-white text-sm min-h-[44px] disabled:opacity-50"
                  >
                    {committing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Confirm
                  </button>
                </div>
              )}
            </div>
          )}
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Review Panel (visible when status = review or review_output exists)  */}
        {/* ------------------------------------------------------------------ */}
        {(task.status === 'review' || task.review_output) && (
          <ReviewPanel
            taskId={task.id}
            reviewOutput={task.review_output}
            reviewStatus={task.review_status}
            onReviewRequested={handleRequestReview}
            onApproved={handleApprove}
            onFixRequested={handleFixFromReview}
            reviewing={reviewing}
            approving={approving}
            fixing={fixing}
            error={reviewError}
          />
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Job History                                                          */}
        {/* ------------------------------------------------------------------ */}
        {jobs.length > 0 && (
          <div className="dark:bg-[#161B22] rounded-xl border dark:border-[#30363D] overflow-hidden">
          <button
            onClick={() => setShowJobHistory((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium dark:text-[#E6EDF3] dark:hover:bg-[#21262D] min-h-[44px]"
          >
            {showJobHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <Clock size={14} />
            Job History ({jobs.length})
          </button>
          {showJobHistory && (
            <div className="border-t dark:border-[#30363D] divide-y dark:divide-[#21262D]">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => {
                    setSelectedJob(job);
                    setShowJobHistory(false);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left dark:hover:bg-[#21262D] min-h-[44px] transition-colors ${
                    selectedJob?.id === job.id ? 'dark:bg-[#21262D]' : ''
                  }`}
                >
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${jobStatusColors(job.status)}`}>
                    {job.status}
                  </span>
                  <span className="text-xs dark:text-gray-400">{job.provider}</span>
                  <span className="text-xs dark:text-gray-500 ml-auto">
                    {formatTime(job.created_at)} · {formatDuration(job.started_at, job.finished_at)}
                  </span>
                </button>
              ))}
            </div>
          )}
          </div>
        )}

        {/* Bottom spacer for mobile */}
        {m && <div className="h-4" />}
      </div>
    </div>
  );
};
