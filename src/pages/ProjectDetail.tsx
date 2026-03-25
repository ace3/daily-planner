import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../stores/projectStore';
import { useMobileStore } from '../stores/mobileStore';
import { Task, CreateTaskInput } from '../types/task';
import {
  getTasksByProject,
  gitStatus,
  gitDiff,
  gitStageAll,
  gitCommit,
  gitPush,
  createTask,
  updateTaskStatus,
  deleteTask,
} from '../lib/tauri';
import {
  ArrowLeft,
  Plus,
  GitBranch,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  Loader2,
  X,
  GitCommit,
  Upload,
  AlertCircle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FilterType = 'all' | 'pending' | 'in_progress' | 'done';

function statusDotClass(status: string): string {
  switch (status) {
    case 'done': return 'bg-emerald-500';
    case 'in_progress': return 'bg-blue-500';
    case 'skipped': return 'bg-gray-500';
    default: return 'bg-gray-400 dark:bg-gray-600';
  }
}

function priorityLabel(p: number): string {
  if (p === 1) return 'High';
  if (p === 2) return 'Med';
  return 'Low';
}

function priorityClass(p: number): string {
  if (p === 1) return 'text-red-400 bg-red-900/30';
  if (p === 2) return 'text-yellow-400 bg-yellow-900/30';
  return 'text-gray-400 bg-gray-700/40';
}

function taskTypeBadge(type: string): string {
  switch (type) {
    case 'prompt': return 'bg-purple-900/40 text-purple-300';
    case 'research': return 'bg-blue-900/40 text-blue-300';
    case 'meeting': return 'bg-orange-900/40 text-orange-300';
    case 'review': return 'bg-teal-900/40 text-teal-300';
    default: return 'bg-gray-700/40 text-gray-400';
  }
}

// ---------------------------------------------------------------------------
// ProjectDetail
// ---------------------------------------------------------------------------

export const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { projects } = useProjectStore();
  const { mobileMode: m } = useMobileStore();

  const project = projects.find((p) => p.id === id);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);

  // Git state
  const [gitBranch, setGitBranch] = useState<string>('');
  const [gitClean, setGitClean] = useState<boolean>(true);
  const [gitChangedFiles, setGitChangedFiles] = useState<number>(0);
  const [diff, setDiff] = useState('');
  const [showGit, setShowGit] = useState(false);
  const [loadingGit, setLoadingGit] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitSuccess, setGitSuccess] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load tasks
  // ---------------------------------------------------------------------------

  const loadTasks = useCallback(async () => {
    if (!id) return;
    setLoadingTasks(true);
    try {
      const result = await getTasksByProject(id);
      setTasks(result);
    } catch (e) {
      console.error('Failed to load project tasks:', e);
    } finally {
      setLoadingTasks(false);
    }
  }, [id]);

  // ---------------------------------------------------------------------------
  // Load git status
  // ---------------------------------------------------------------------------

  const loadGitStatus = useCallback(async () => {
    if (!project?.path) return;
    setLoadingGit(true);
    setGitError(null);
    try {
      const status = await gitStatus(project.path);
      setGitBranch(status.branch);
      setGitClean(status.files.length === 0);
      setGitChangedFiles(status.files.length);
      if (status.files.length > 0) {
        const d = await gitDiff(project.path);
        setDiff(d);
      } else {
        setDiff('');
      }
    } catch (e) {
      console.error('Failed to load git status:', e);
      setGitError(String(e));
    } finally {
      setLoadingGit(false);
    }
  }, [project?.path]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (showGit) {
      loadGitStatus();
    }
  }, [showGit, loadGitStatus]);

  // ---------------------------------------------------------------------------
  // Task actions
  // ---------------------------------------------------------------------------

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || !id) return;
    setAdding(true);
    try {
      const input: CreateTaskInput = { title, task_type: 'other', priority: 2, project_id: id };
      await createTask(input);
      setNewTitle('');
      await loadTasks();
    } catch (e) {
      console.error('Failed to create task:', e);
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (taskId: string, current: string) => {
    const next = current === 'done' ? 'pending' : 'done';
    try {
      await updateTaskStatus(taskId, next);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: next as Task['status'] } : t))
      );
    } catch (e) {
      console.error('Failed to update task status:', e);
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (e) {
      console.error('Failed to delete task:', e);
    }
  };

  // ---------------------------------------------------------------------------
  // Git actions
  // ---------------------------------------------------------------------------

  const handleCommit = async () => {
    if (!project?.path || !commitMsg.trim()) return;
    setCommitting(true);
    setGitError(null);
    setGitSuccess(null);
    try {
      await gitStageAll(project.path);
      await gitCommit(project.path, commitMsg.trim());
      setCommitMsg('');
      setGitSuccess('Committed successfully.');
      await loadGitStatus();
    } catch (e) {
      setGitError(`Commit failed: ${e}`);
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    if (!project?.path) return;
    setPushing(true);
    setGitError(null);
    setGitSuccess(null);
    try {
      await gitPush(project.path);
      setGitSuccess('Pushed successfully.');
    } catch (e) {
      setGitError(`Push failed: ${e}`);
    } finally {
      setPushing(false);
    }
  };

  const [showCompleted, setShowCompleted] = useState(false);

  // ---------------------------------------------------------------------------
  // Filtered tasks
  // ---------------------------------------------------------------------------

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'all') return t.status !== 'done';
    if (filter === 'done') return t.status === 'done';
    return t.status === filter;
  });

  const completedTasks = tasks.filter((t) => t.status === 'done');

  const filterTabs: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'done', label: 'Done' },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!project) {
    return (
      <div className={`${m ? 'p-3' : 'p-6'} flex flex-col items-center justify-center gap-4 h-full`}>
        <AlertCircle size={32} className="dark:text-gray-500" />
        <p className="dark:text-gray-400 text-sm">Project not found.</p>
        <button
          onClick={() => navigate('/projects')}
          className="text-sm dark:text-blue-400 hover:underline min-h-[44px] flex items-center"
        >
          ← Back to Projects
        </button>
      </div>
    );
  }

  return (
    <div className={`${m ? 'p-3' : 'p-6'} space-y-5 overflow-y-auto h-full`} data-scrollable>

      {/* Header */}
      <div className="space-y-1">
        <button
          onClick={() => navigate('/projects')}
          className={`flex items-center gap-1.5 dark:text-gray-400 hover:dark:text-[#E6EDF3] transition-colors text-sm ${m ? 'min-h-[44px]' : ''}`}
        >
          <ArrowLeft size={15} />
          Back
        </button>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className={`font-bold dark:text-[#E6EDF3] leading-tight ${m ? 'text-xl' : 'text-2xl'}`}>
              {project.name}
            </h1>
            <p className="text-xs dark:text-gray-500 mt-0.5 truncate">{project.path}</p>
          </div>
          {gitBranch && (
            <span className="shrink-0 flex items-center gap-1.5 text-xs dark:bg-[#161B22] border border-white/10 rounded-full px-3 py-1 dark:text-gray-400 mt-1">
              <GitBranch size={11} />
              {gitBranch}
            </span>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {filterTabs.map(({ key, label }) => {
          const count = key === 'all'
            ? tasks.filter((t) => t.status !== 'done').length
            : tasks.filter((t) => t.status === key).length;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`shrink-0 px-3 rounded-lg text-sm font-medium transition-colors ${m ? 'h-10' : 'h-9'} ${
                filter === key
                  ? 'dark:bg-blue-600 text-white'
                  : 'dark:bg-[#161B22] dark:text-gray-400 hover:dark:text-[#E6EDF3] border border-white/5'
              }`}
            >
              {label}
              <span className={`ml-1.5 text-xs ${filter === key ? 'opacity-70' : 'dark:text-gray-600'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Add task form */}
      <form onSubmit={handleAddTask} className="flex gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a task…"
          className={`flex-1 rounded-lg px-3 dark:bg-[#161B22] border border-white/10 dark:text-[#E6EDF3] dark:placeholder-gray-600 focus:outline-none focus:border-blue-500/60 text-sm ${m ? 'h-11' : 'h-10'}`}
        />
        <button
          type="submit"
          disabled={adding || !newTitle.trim()}
          className={`shrink-0 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-1.5 ${m ? 'h-11' : 'h-10'}`}
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
      </form>

      {/* Task list */}
      <section>
        {loadingTasks ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin dark:text-gray-500" />
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 dark:text-gray-600">
            <p className="text-sm">No tasks</p>
          </div>
        ) : (
          <div className="divide-y dark:divide-white/5">
            {filteredTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3 py-2.5 group">
                {/* Status toggle */}
                <button
                  onClick={() => handleToggle(task.id, task.status)}
                  className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg dark:hover:bg-white/5 transition-colors"
                  aria-label="Toggle status"
                >
                  {task.status === 'done' ? (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  ) : task.status === 'in_progress' ? (
                    <Circle size={16} className="text-blue-400" />
                  ) : (
                    <Circle size={16} className="dark:text-gray-500" />
                  )}
                </button>

                {/* Title */}
                <button
                  onClick={() => navigate(`/tasks/${task.id}`)}
                  className={`flex-1 min-w-0 text-left text-sm dark:text-[#E6EDF3] truncate ${task.status === 'done' ? 'line-through dark:text-gray-500' : ''}`}
                >
                  {task.title}
                </button>

                {/* Badges */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Job badge */}
                  {(task.job_status === 'running' || task.job_status === 'queued') && (
                    <span className="flex items-center gap-1 text-xs bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded-full">
                      <Loader2 size={9} className="animate-spin" />
                      {task.job_status}
                    </span>
                  )}
                  {/* Priority badge */}
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium hidden sm:inline ${priorityClass(task.priority)}`}>
                    {priorityLabel(task.priority)}
                  </span>
                  {/* Type badge */}
                  <span className={`text-xs px-1.5 py-0.5 rounded hidden sm:inline ${taskTypeBadge(task.task_type)}`}>
                    {task.task_type}
                  </span>
                  {/* Status dot */}
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(task.status)}`} />
                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="w-9 h-9 flex items-center justify-center rounded-lg dark:hover:bg-red-900/30 dark:text-gray-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    aria-label="Delete task"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Completed accordion — only when not on Done filter */}
      {filter !== 'done' && completedTasks.length > 0 && (
        <section className="dark:bg-[#161B22] border border-white/5 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className={`w-full flex items-center justify-between px-4 dark:text-[#E6EDF3] hover:dark:bg-white/5 transition-colors ${m ? 'h-12' : 'h-11'}`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-500" />
              <span className="font-medium text-sm">Completed</span>
              <span className="text-xs dark:text-gray-500">{completedTasks.length}</span>
            </div>
            {showCompleted ? <ChevronUp size={15} className="dark:text-gray-400" /> : <ChevronDown size={15} className="dark:text-gray-400" />}
          </button>

          {showCompleted && (
            <div className="border-t border-white/5 divide-y dark:divide-white/5">
              {completedTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-2.5 group">
                  <button
                    onClick={() => handleToggle(task.id, task.status)}
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg dark:hover:bg-white/5 transition-colors"
                    aria-label="Toggle status"
                  >
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  </button>
                  <button
                    onClick={() => navigate(`/tasks/${task.id}`)}
                    className="flex-1 min-w-0 text-left text-sm line-through dark:text-gray-500 truncate"
                  >
                    {task.title}
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium hidden sm:inline ${priorityClass(task.priority)}`}>
                      {priorityLabel(task.priority)}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded hidden sm:inline ${taskTypeBadge(task.task_type)}`}>
                      {task.task_type}
                    </span>
                    <button
                      onClick={() => handleDelete(task.id)}
                      className="w-9 h-9 flex items-center justify-center rounded-lg dark:hover:bg-red-900/30 dark:text-gray-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      aria-label="Delete task"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Git Panel */}
      <section className="dark:bg-[#161B22] border border-white/5 rounded-xl overflow-hidden">
        {/* Collapsible header */}
        <button
          onClick={() => setShowGit((v) => !v)}
          className={`w-full flex items-center justify-between px-4 dark:text-[#E6EDF3] hover:dark:bg-white/5 transition-colors ${m ? 'h-12' : 'h-11'}`}
        >
          <div className="flex items-center gap-2">
            <GitBranch size={15} className="dark:text-gray-400" />
            <span className="font-medium text-sm">Git</span>
            {!loadingGit && gitBranch && (
              <span className="text-xs dark:text-gray-500">{gitBranch}</span>
            )}
            {!loadingGit && !gitClean && showGit && (
              <span className="text-xs bg-yellow-900/40 text-yellow-400 px-1.5 py-0.5 rounded">
                {gitChangedFiles} changed
              </span>
            )}
            {!loadingGit && gitClean && showGit && (
              <span className="text-xs bg-emerald-900/40 text-emerald-400 px-1.5 py-0.5 rounded">clean</span>
            )}
          </div>
          {showGit ? <ChevronUp size={15} className="dark:text-gray-400" /> : <ChevronDown size={15} className="dark:text-gray-400" />}
        </button>

        {/* Expanded content */}
        {showGit && (
          <div className="border-t border-white/5 p-4 space-y-4">
            {loadingGit ? (
              <div className="flex justify-center py-4">
                <Loader2 size={18} className="animate-spin dark:text-gray-500" />
              </div>
            ) : (
              <>
                {/* Error / success messages */}
                {gitError && (
                  <div className="flex items-start gap-2 text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span>{gitError}</span>
                  </div>
                )}
                {gitSuccess && (
                  <div className="text-xs text-emerald-400 bg-emerald-900/20 rounded-lg px-3 py-2">
                    {gitSuccess}
                  </div>
                )}

                {/* Diff preview */}
                {!gitClean && diff && (
                  <div>
                    <p className="text-xs dark:text-gray-500 mb-1.5">{gitChangedFiles} changed file{gitChangedFiles !== 1 ? 's' : ''}</p>
                    <pre className="text-xs font-mono dark:bg-[#0D1117] p-3 rounded-lg overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre">
                      {diff.split('\n').slice(0, 50).map((line, i) => (
                        <div key={i} className={
                          line.startsWith('+') ? 'text-green-400' :
                          line.startsWith('-') ? 'text-red-400' :
                          line.startsWith('@@') ? 'text-blue-400' :
                          'dark:text-gray-400'
                        }>{line}</div>
                      ))}
                    </pre>
                  </div>
                )}

                {gitClean && (
                  <p className="text-sm dark:text-gray-500 text-center py-2">Working tree is clean.</p>
                )}

                {/* Commit form */}
                {!gitClean && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={commitMsg}
                      onChange={(e) => setCommitMsg(e.target.value)}
                      placeholder="Commit message…"
                      className={`w-full rounded-lg px-3 dark:bg-[#0D1117] border border-white/10 dark:text-[#E6EDF3] dark:placeholder-gray-600 focus:outline-none focus:border-blue-500/60 text-sm ${m ? 'h-11' : 'h-10'}`}
                    />
                    <button
                      onClick={handleCommit}
                      disabled={committing || !commitMsg.trim()}
                      className={`w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors ${m ? 'h-11' : 'h-10'}`}
                    >
                      {committing ? <Loader2 size={14} className="animate-spin" /> : <GitCommit size={14} />}
                      Commit All Changes
                    </button>
                  </div>
                )}

                {/* Push button */}
                <button
                  onClick={handlePush}
                  disabled={pushing}
                  className={`w-full flex items-center justify-center gap-2 rounded-lg dark:bg-[#21262D] hover:dark:bg-[#30363D] disabled:opacity-40 disabled:cursor-not-allowed dark:text-[#E6EDF3] text-sm font-medium transition-colors border border-white/10 ${m ? 'h-11' : 'h-10'}`}
                >
                  {pushing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Push
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
