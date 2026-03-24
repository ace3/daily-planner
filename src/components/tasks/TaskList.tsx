import React, { useState } from 'react';
import { TaskItem } from './TaskItem';
import { TaskForm } from './TaskForm';
import { useTaskStore } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useMobileStore } from '../../stores/mobileStore';
import { usePromptQueue } from '../../hooks/usePromptQueue';
import type { Task } from '../../types/task';
import { getLocalDate } from '../../lib/time';
import { useSettingsStore } from '../../stores/settingsStore';
import { addDays, format } from 'date-fns';
import { toast } from '../ui/Toast';
import { FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';

interface TaskListProps {
  onTaskSelect?: (task: Task) => void;
}

export const TaskList: React.FC<TaskListProps> = ({ onTaskSelect }) => {
  const [completedOpen, setCompletedOpen] = useState(false);
  const { mobileMode: m } = useMobileStore();
  const {
    tasks,
    createTask,
    updateTaskStatus,
    deleteTask,
    carryTaskForward,
    updateTask,
    runTaskAsWorktree,
    cleanupTaskWorktree,
  } = useTaskStore();
  const { settings } = useSettingsStore();
  const { projects } = useProjectStore();
  const { enqueue } = usePromptQueue();

  const handleCreate = async (input: Parameters<typeof createTask>[0]) => {
    await createTask(input);
    toast.success('Task added');
  };

  const handleStatusChange = async (id: string, status: string) => {
    await updateTaskStatus(id, status);
  };

  const handleDelete = async (id: string) => {
    await deleteTask(id);
    toast.success('Task deleted');
  };

  const handleCarryForward = async (id: string) => {
    const tz = settings?.timezone_offset ?? 7;
    const today = getLocalDate(tz);
    const tomorrow = format(addDays(new Date(today + 'T00:00:00'), 1), 'yyyy-MM-dd');
    await carryTaskForward(id, tomorrow);
    toast.success('Task carried to tomorrow');
  };

  const handleNotesUpdate = async (id: string, notes: string) => {
    await updateTask({ id, notes });
  };

  const handleProjectChange = async (id: string, projectId: string | null) => {
    if (projectId) {
      await updateTask({ id, project_id: projectId });
    } else {
      await updateTask({ id, clear_project: true });
    }
  };

  const handleRunAsWorktree = async (task: Task) => {
    if (!task.project_id) {
      toast.warning('Assign a project before running as worktree');
      return;
    }

    const result = await runTaskAsWorktree(task.id);
    enqueue({
      prompt: result.prompt_to_run,
      projectPath: result.worktree_path,
      provider: 'claude',
    });
    toast.success(`Running in worktree branch ${result.branch_name}`);
  };

  const handleCleanupWorktree = async (task: Task) => {
    const result = await cleanupTaskWorktree(task.id);
    if (result.warning) {
      toast.warning(result.warning);
      return;
    }
    toast.success(result.branch_deleted ? 'Worktree cleaned up and branch deleted' : 'Worktree cleaned up');
  };

  const doneTasks = tasks.filter((t) => t.status === 'done');
  const pendingTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'carried_over');

  // Group pending tasks by project
  const tasksByProject = new Map<string | null, Task[]>();
  pendingTasks.forEach((task) => {
    const key = task.project_id ?? null;
    if (!tasksByProject.has(key)) tasksByProject.set(key, []);
    tasksByProject.get(key)!.push(task);
  });

  // Build ordered groups: named projects first (sorted by name), then "No Project"
  const projectGroups: Array<{ projectId: string | null; name: string; tasks: Task[] }> = [];
  projects.forEach((p) => {
    const pTasks = tasksByProject.get(p.id);
    if (pTasks && pTasks.length > 0) {
      projectGroups.push({ projectId: p.id, name: p.name, tasks: pTasks });
    }
  });
  projectGroups.sort((a, b) => a.name.localeCompare(b.name));

  const noProjectTasks = tasksByProject.get(null) ?? [];
  const showProjectHeaders = projectGroups.length > 0;

  const renderTaskItem = (task: Task) => (
    <TaskItem
      key={task.id}
      task={task}
      onStatusChange={handleStatusChange}
      onDelete={handleDelete}
      onCarryForward={handleCarryForward}
      onNotesUpdate={handleNotesUpdate}
      onProjectChange={handleProjectChange}
      onSelect={onTaskSelect}
      onRunAsWorktree={handleRunAsWorktree}
      onCleanupWorktree={handleCleanupWorktree}
    />
  );

  return (
    <div className={m ? 'space-y-4' : 'space-y-3'}>
      <div className="flex items-center justify-between">
        <span className={`font-semibold text-gray-400 dark:text-[#8B949E] uppercase tracking-wide ${m ? 'text-sm' : 'text-xs'}`}>
          Tasks
        </span>
        <span className={`text-gray-400 dark:text-[#484F58] ${m ? 'text-sm' : 'text-xs'}`}>
          {doneTasks.length}/{tasks.filter((t) => t.status !== 'carried_over').length}
        </span>
      </div>

      <TaskForm onSubmit={handleCreate} compact />

      <div className={m ? 'space-y-3' : 'space-y-1.5'}>
        {/* Project groups */}
        {projectGroups.map(({ projectId, name, tasks: groupTasks }) => (
          <div key={projectId} className={m ? 'space-y-3' : 'space-y-1.5'}>
            <div className="flex items-center gap-1.5 px-1">
              <FolderOpen size={m ? 14 : 11} className="text-blue-400 shrink-0" />
              <span className={`font-medium text-gray-500 dark:text-[#8B949E] truncate ${m ? 'text-sm' : 'text-xs'}`}>{name}</span>
              <div className="flex-1 h-px bg-gray-100 dark:bg-[#21262D]" />
            </div>
            <div className={m ? 'space-y-3' : 'space-y-1.5'}>
              {groupTasks.map(renderTaskItem)}
            </div>
          </div>
        ))}

        {/* No Project tasks */}
        {noProjectTasks.length > 0 && (
          <div className={m ? 'space-y-3' : 'space-y-1.5'}>
            {showProjectHeaders && (
              <div className="flex items-center gap-1.5 px-1">
                <span className={`font-medium text-gray-400 dark:text-[#484F58] ${m ? 'text-sm' : 'text-xs'}`}>No Project</span>
                <div className="flex-1 h-px bg-gray-100 dark:bg-[#21262D]" />
              </div>
            )}
            <div className={m ? 'space-y-3' : 'space-y-1.5'}>
              {noProjectTasks.map(renderTaskItem)}
            </div>
          </div>
        )}

        {pendingTasks.length === 0 && (
          <div className={`text-center border border-dashed border-gray-200 dark:border-[#21262D] rounded-lg text-gray-400 dark:text-[#484F58]
            ${m ? 'text-sm py-5' : 'text-xs py-3'}`}>
            No tasks yet. Add one above.
          </div>
        )}
      </div>

      {doneTasks.length > 0 && (
        <div className={m ? 'space-y-3' : 'space-y-1.5'}>
          <button
            onClick={() => setCompletedOpen((v) => !v)}
            className={`flex items-center gap-2 text-gray-400 dark:text-[#484F58] hover:text-gray-600 dark:hover:text-[#8B949E] transition-colors cursor-pointer w-full text-left
              ${m ? 'text-sm min-h-[44px]' : 'text-xs'}`}
          >
            {completedOpen ? <ChevronDown size={m ? 16 : 12} /> : <ChevronRight size={m ? 16 : 12} />}
            Completed ({doneTasks.length})
          </button>
          {completedOpen && (
            <div className={m ? 'space-y-3' : 'space-y-1.5'}>
              {doneTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onCarryForward={handleCarryForward}
                  onNotesUpdate={handleNotesUpdate}
                  onSelect={onTaskSelect}
                  onRunAsWorktree={handleRunAsWorktree}
                  onCleanupWorktree={handleCleanupWorktree}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
