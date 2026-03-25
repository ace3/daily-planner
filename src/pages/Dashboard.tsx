import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMobileStore } from '../stores/mobileStore';
import { useProjectStore } from '../stores/projectStore';
import { useJobStore } from '../stores/jobStore';
import { Task, CreateTaskInput } from '../types/task';
import { PromptJob } from '../types/job';
import {
  getStandaloneTasks,
  getTasksByProject,
  createTask,
  updateTaskStatus,
  deleteTask,
} from '../lib/tauri';
import { Plus, X, FolderOpen, Loader2, CheckCircle2, Circle, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elapsedTime(job: PromptJob): string {
  const start = job.started_at ?? job.created_at;
  try {
    return formatDistanceToNow(new Date(start), { addSuffix: false });
  } catch {
    return '—';
  }
}

function relativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return '—';
  }
}

function providerBadgeClass(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes('claude')) return 'bg-purple-900/50 text-purple-300';
  if (p.includes('opencode') || p.includes('openai')) return 'bg-blue-900/50 text-blue-300';
  return 'bg-gray-700/60 text-gray-300';
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'done': return 'bg-emerald-500';
    case 'in_progress': return 'bg-blue-500';
    case 'skipped': return 'bg-gray-500';
    default: return 'bg-gray-400 dark:bg-gray-600';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ActiveJobRowProps {
  job: PromptJob;
  projectName?: string;
  onCancel: (id: string) => void;
  mobile: boolean;
}

const ActiveJobRow: React.FC<ActiveJobRowProps> = ({ job, projectName, onCancel, mobile }) => (
  <div className="flex items-center gap-3 dark:bg-[#161B22] rounded-lg px-3 py-2.5 border border-white/5">
    <Loader2 size={14} className="animate-spin text-green-400 shrink-0" />
    <div className="flex-1 min-w-0">
      <p className={`truncate dark:text-[#E6EDF3] ${mobile ? 'text-sm' : 'text-sm'}`}>
        {job.prompt?.slice(0, 60) ?? 'Running…'}
      </p>
      <div className="flex items-center gap-2 mt-0.5">
        {projectName && (
          <span className="text-xs dark:text-gray-500 truncate">{projectName}</span>
        )}
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${providerBadgeClass(job.provider)}`}>
          {job.provider}
        </span>
        <span className="text-xs dark:text-gray-500 flex items-center gap-1">
          <Clock size={10} />
          {elapsedTime(job)}
        </span>
      </div>
    </div>
    <button
      onClick={() => onCancel(job.id)}
      className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg dark:hover:bg-red-900/30 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
      aria-label="Cancel job"
    >
      <X size={14} />
    </button>
  </div>
);


interface TaskRowProps {
  task: Task;
  onToggle: (id: string, current: string) => void;
  onDelete: (id: string) => void;
  mobile: boolean;
}

const TaskRow: React.FC<TaskRowProps> = ({ task, onToggle, onDelete, mobile }) => (
  <div className="flex items-center gap-3 py-2 group">
    <button
      onClick={() => onToggle(task.id, task.status)}
      className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg dark:hover:bg-white/5 transition-colors"
      aria-label="Toggle status"
    >
      {task.status === 'done' ? (
        <CheckCircle2 size={16} className="text-emerald-500" />
      ) : (
        <Circle size={16} className="dark:text-gray-500" />
      )}
    </button>
    <span
      className={`flex-1 min-w-0 truncate ${mobile ? 'text-sm' : 'text-sm'} dark:text-[#E6EDF3] ${task.status === 'done' ? 'line-through dark:text-gray-500' : ''}`}
    >
      {task.title}
    </span>
    <div className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(task.status)}`} />
      <button
        onClick={() => onDelete(task.id)}
        className="w-9 h-9 flex items-center justify-center rounded-lg dark:hover:bg-red-900/30 dark:text-gray-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
        aria-label="Delete task"
      >
        <X size={13} />
      </button>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const Dashboard: React.FC = () => {
  const { mobileMode: m } = useMobileStore();
  const { projects, fetchProjects } = useProjectStore();
  const { activeJobs, fetchActiveJobs, cancelJob } = useJobStore();
  const navigate = useNavigate();

  const [standaloneTasks, setStandaloneTasks] = useState<Task[]>([]);
  const [projectTasks, setProjectTasks] = useState<Record<string, Task[]>>({});
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const loadStandaloneTasks = useCallback(async () => {
    try {
      const tasks = await getStandaloneTasks();
      setStandaloneTasks(tasks);
    } catch (e) {
      console.error('Failed to load standalone tasks:', e);
    }
  }, []);

  const loadProjectTasks = useCallback(async (projectIds: string[]) => {
    if (projectIds.length === 0) return;
    try {
      const entries = await Promise.all(
        projectIds.map(async (id) => {
          try {
            const tasks = await getTasksByProject(id);
            return [id, tasks] as [string, Task[]];
          } catch {
            return [id, []] as [string, Task[]];
          }
        })
      );
      setProjectTasks(Object.fromEntries(entries));
    } catch (e) {
      console.error('Failed to load project tasks:', e);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchActiveJobs();
    loadStandaloneTasks();
  }, []);

  // Load project tasks once projects are available
  useEffect(() => {
    if (projects.length > 0) {
      loadProjectTasks(projects.map((p) => p.id));
    }
  }, [projects]);

  // Build a map of project_id -> active job count
  const projectActiveJobs: Record<string, number> = {};
  for (const job of activeJobs) {
    if (job.project_id) {
      projectActiveJobs[job.project_id] = (projectActiveJobs[job.project_id] ?? 0) + 1;
    }
  }

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      const input: CreateTaskInput = { title, task_type: 'other', priority: 2 };
      await createTask(input);
      setNewTitle('');
      await loadStandaloneTasks();
    } catch (e) {
      console.error('Failed to create task:', e);
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (id: string, current: string) => {
    const next = current === 'done' ? 'pending' : 'done';
    try {
      await updateTaskStatus(id, next);
      setStandaloneTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: next as Task['status'] } : t))
      );
    } catch (e) {
      console.error('Failed to update task status:', e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTask(id);
      setStandaloneTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      console.error('Failed to delete task:', e);
    }
  };

  const handleToggleProjectTask = async (id: string, current: string) => {
    const next = current === 'done' ? 'pending' : 'done';
    try {
      await updateTaskStatus(id, next);
      setProjectTasks((prev) => {
        const updated = { ...prev };
        for (const pid of Object.keys(updated)) {
          updated[pid] = updated[pid].map((t) =>
            t.id === id ? { ...t, status: next as Task['status'] } : t
          );
        }
        return updated;
      });
    } catch (e) {
      console.error('Failed to update project task status:', e);
    }
  };

  const handleDeleteProjectTask = async (id: string) => {
    try {
      await deleteTask(id);
      setProjectTasks((prev) => {
        const updated = { ...prev };
        for (const pid of Object.keys(updated)) {
          updated[pid] = updated[pid].filter((t) => t.id !== id);
        }
        return updated;
      });
    } catch (e) {
      console.error('Failed to delete project task:', e);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await cancelJob(jobId);
    } catch (e) {
      console.error('Failed to cancel job:', e);
    }
  };

  return (
    <div className={`${m ? 'p-3' : 'p-6'} space-y-6 overflow-y-auto h-full`} data-scrollable>

      {/* Section 1: Active Jobs */}
      {activeJobs.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <h2 className={`font-semibold ${m ? 'text-base' : 'text-lg'} dark:text-[#E6EDF3]`}>
              Running Jobs
            </h2>
            <span className="text-xs dark:text-gray-500">{activeJobs.length}</span>
          </div>
          <div className="space-y-2">
            {activeJobs.map((job) => {
              const project = projects.find((p) => p.id === job.project_id);
              return (
                <ActiveJobRow
                  key={job.id}
                  job={job}
                  projectName={project?.name}
                  onCancel={handleCancelJob}
                  mobile={m}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Section 2: Projects Grid */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`font-semibold ${m ? 'text-base' : 'text-lg'} dark:text-[#E6EDF3]`}>
            Projects
          </h2>
          <button
            onClick={() => navigate('/projects')}
            className="text-sm dark:text-blue-400 hover:underline min-h-[44px] px-2 flex items-center"
          >
            View All
          </button>
        </div>
        <div className="space-y-3">
          {projects.map((project) => {
            const tasks = projectTasks[project.id] ?? [];
            const activeTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
            return (
              <div key={project.id} className="dark:bg-[#161B22] border border-white/5 rounded-xl overflow-hidden">
                <button
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className={`w-full text-left p-4 hover:dark:bg-[#1C2128] transition-all active:scale-[0.99] ${activeTasks.length > 0 ? '' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`font-medium dark:text-[#E6EDF3] leading-snug ${m ? 'text-sm' : 'text-sm'}`}>{project.name}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      {(projectActiveJobs[project.id] ?? 0) > 0 && (
                        <span className="flex items-center gap-1 text-xs bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                          {projectActiveJobs[project.id]}
                        </span>
                      )}
                      <span className="text-xs dark:bg-[#21262D] dark:text-gray-400 px-2 py-0.5 rounded-full">
                        {tasks.length}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs dark:text-gray-500 mt-1">{relativeTime(project.created_at)}</p>
                </button>
                {activeTasks.length > 0 && (
                  <div className="px-4 pb-3 border-t border-white/5">
                    <div className="divide-y dark:divide-white/5">
                      {activeTasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          onToggle={handleToggleProjectTask}
                          onDelete={handleDeleteProjectTask}
                          mobile={m}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {/* New Project card */}
          <button
            onClick={() => navigate('/projects')}
            className={`w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed dark:border-white/10 rounded-xl p-4 dark:text-gray-500 hover:dark:border-blue-500/40 hover:dark:text-blue-400 transition-all ${m ? 'min-h-[80px]' : 'min-h-[80px]'}`}
          >
            <Plus size={18} />
            <span className="text-xs font-medium">New Project</span>
          </button>
        </div>
      </section>

      {/* Section 3: Standalone Tasks */}
      <section>
        <h2 className={`font-semibold ${m ? 'text-base' : 'text-lg'} dark:text-[#E6EDF3] mb-3`}>
          Quick Tasks
        </h2>

        {/* Inline add form */}
        <form onSubmit={handleAddTask} className="flex gap-2 mb-3">
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
        {standaloneTasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 dark:text-gray-600">
            <FolderOpen size={24} />
            <p className="text-sm">No quick tasks yet</p>
          </div>
        ) : (
          <div className="divide-y dark:divide-white/5">
            {standaloneTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={handleToggle}
                onDelete={handleDelete}
                mobile={m}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
