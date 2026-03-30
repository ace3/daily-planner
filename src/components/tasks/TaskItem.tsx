import React, { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Trash2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  GripVertical,
  GitBranchPlus,
  FolderX,
  MoreHorizontal,
} from 'lucide-react';
import { Badge } from '../ui/Badge';
import { TaskNotes } from './TaskNotes';
import { useMobileStore } from '../../stores/mobileStore';
import type { Task } from '../../types/task';
import { formatDuration } from '../../lib/time';

interface TaskItemProps {
  task: Task;
  onStatusChange: (id: string, status: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCarryForward: (id: string) => Promise<void>;
  onNotesUpdate: (id: string, notes: string) => Promise<void>;
  onProjectChange?: (id: string, projectId: string | null) => Promise<void>;
  onSelect?: (task: Task) => void;
  onRunAsWorktree?: (task: Task) => Promise<void>;
  onCleanupWorktree?: (task: Task) => Promise<void>;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: () => void;
}

const typeColors: Record<string, 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'purple'> = {
  code: 'blue',
  research: 'purple',
  prompt: 'green',
  meeting: 'amber',
  review: 'red',
  other: 'gray',
};

const priorityColors = ['', 'text-red-400', 'text-amber-400', 'text-gray-400 dark:text-[#484F58]'];
const priorityDots = ['', '●', '●', '●'];
const statusBadge: Record<Task['status'], { label: string; variant: 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'purple' }> = {
  todo: { label: 'To-Do', variant: 'gray' },
  improved: { label: 'Improved', variant: 'purple' },
  planned: { label: 'Planned', variant: 'blue' },
  in_progress: { label: 'In Progress', variant: 'blue' },
  review: { label: 'Review', variant: 'green' },
  done: { label: 'Done', variant: 'green' },
};
const DRAG_TASK_ID_MIME = 'application/x-task-id';

export const TaskItem: React.FC<TaskItemProps> = ({
  task,
  onStatusChange,
  onDelete,
  onCarryForward,
  onNotesUpdate,
  onProjectChange,
  onSelect,
  onRunAsWorktree,
  onCleanupWorktree,
  onDragStart,
  onDragEnd,
}) => {
  const [expanded, setExpanded] = useState(false);
  const { mobileMode: m } = useMobileStore();
  const isDone = task.status === 'review' || (task.status as string) === 'done';

  // --- MOBILE LAYOUT ---
  if (m) {
    return (
      <div
        className={`
          rounded-xl border transition-colors duration-150
          ${isDone
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22]'}
        `}
      >
        {/* Main row: checkbox + title + expand toggle */}
        <div className="flex items-center gap-3 p-3">
          {/* Status toggle — big tap target */}
          <button
            onClick={() => onStatusChange(task.id, isDone ? 'todo' : 'review')}
            className="shrink-0 cursor-pointer text-gray-400 dark:text-[#484F58] hover:text-emerald-400 transition-colors p-1 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            {isDone ? (
              <CheckCircle2 size={24} className="text-emerald-400" />
            ) : (
              <Circle size={24} />
            )}
          </button>

          {/* Title + badges — tap to select */}
          <div className="flex-1 min-w-0" onClick={() => onSelect?.(task)}>
            <span
              className={`text-base block ${
                isDone ? 'line-through text-gray-400 dark:text-[#484F58]' : 'text-gray-900 dark:text-[#E6EDF3]'
              }`}
            >
              {task.title}
            </span>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge variant={typeColors[task.task_type] || 'gray'}>{task.task_type}</Badge>
              <Badge variant={statusBadge[task.status].variant}>{statusBadge[task.status].label}</Badge>
              {task.priority > 0 && (
                <span className={`text-sm ${priorityColors[task.priority]}`}>
                  {priorityDots[task.priority]}
                </span>
              )}
              {task.worktree_status === 'active' && <Badge variant="blue">worktree</Badge>}
              {task.estimated_min && (
                <span className="text-xs text-gray-400 dark:text-[#484F58]">{formatDuration(task.estimated_min)}</span>
              )}
              {task.carried_from && <Badge variant="amber">carried</Badge>}
            </div>
          </div>

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 dark:text-[#484F58] cursor-pointer rounded-lg"
          >
            {expanded ? <ChevronUp size={20} /> : <MoreHorizontal size={20} />}
          </button>
        </div>

        {/* Expanded: action buttons row + notes */}
        {expanded && (
          <div className="border-t border-gray-100 dark:border-[#21262D]">
            {/* Action buttons — horizontal scrollable row */}
            <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto">
              {!isDone && (
                <button
                  onClick={() => onCarryForward(task.id)}
                  className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-sm text-blue-400 bg-blue-500/10 border border-blue-500/20 whitespace-nowrap cursor-pointer"
                >
                  <ArrowRight size={16} />
                  Tomorrow
                </button>
              )}
              {task.project_id && (
                <button
                  onClick={() => onRunAsWorktree?.(task)}
                  className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-sm text-purple-400 bg-purple-500/10 border border-purple-500/20 whitespace-nowrap cursor-pointer"
                >
                  <GitBranchPlus size={16} />
                  Worktree
                </button>
              )}
              {task.worktree_status === 'active' && (
                <button
                  onClick={() => onCleanupWorktree?.(task)}
                  className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 whitespace-nowrap cursor-pointer"
                >
                  <FolderX size={16} />
                  Cleanup
                </button>
              )}
              <button
                onClick={() => onDelete(task.id)}
                className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-sm text-red-400 bg-red-500/10 border border-red-500/20 whitespace-nowrap cursor-pointer"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>

            {/* Notes */}
            <div className="px-4 pb-4 pt-2">
              <TaskNotes
                task={task}
                onSave={(notes) => onNotesUpdate(task.id, notes)}
                onProjectChange={onProjectChange ? (pid) => onProjectChange(task.id, pid) : undefined}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- DESKTOP LAYOUT (unchanged) ---
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(DRAG_TASK_ID_MIME, task.id);
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.setData('application/x-task-status', task.status);
        onDragStart?.(task.id);
      }}
      onDragEnd={() => onDragEnd?.()}
      className={`
        group rounded-lg border transition-colors duration-150
        ${isDone
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : 'border-gray-200 bg-white hover:border-gray-300 dark:border-[#30363D] dark:bg-[#161B22] dark:hover:border-[#444C56]'}
      `}
    >
      <div className="flex items-start gap-2.5 p-3">
        {/* Drag handle */}
        <GripVertical
          size={14}
          className="text-gray-300 dark:text-[#30363D] mt-0.5 cursor-grab shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        />

        {/* Status toggle */}
        <button
          onClick={() => onStatusChange(task.id, isDone ? 'todo' : 'review')}
          className="mt-0.5 shrink-0 cursor-pointer text-gray-400 dark:text-[#484F58] hover:text-emerald-400 transition-colors"
        >
          {isDone ? (
            <CheckCircle2 size={16} className="text-emerald-400" />
          ) : (
            <Circle size={16} />
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-sm cursor-pointer ${
                isDone ? 'line-through text-gray-400 dark:text-[#484F58]' : 'text-gray-900 dark:text-[#E6EDF3]'
              }`}
              onClick={() => onSelect?.(task)}
            >
              {task.title}
            </span>
            <span className={`text-xs ${priorityColors[task.priority]}`}>
              {priorityDots[task.priority]}
            </span>
            <Badge variant={typeColors[task.task_type] || 'gray'}>{task.task_type}</Badge>
            <Badge variant={statusBadge[task.status].variant}>{statusBadge[task.status].label}</Badge>
            {task.worktree_status === 'active' && <Badge variant="blue">worktree active</Badge>}
            {task.worktree_status === 'merged' && <Badge variant="green">worktree merged</Badge>}
            {task.worktree_status === 'abandoned' && <Badge variant="amber">worktree abandoned</Badge>}
            {task.estimated_min && (
              <span className="text-xs text-gray-400 dark:text-[#484F58]">{formatDuration(task.estimated_min)}</span>
            )}
            {task.carried_from && <Badge variant="amber">carried</Badge>}
          </div>

          {task.notes && !expanded && (
            <p className="text-xs text-gray-400 dark:text-[#484F58] mt-0.5 truncate">{task.notes}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {!isDone && (
            <button
              onClick={() => onCarryForward(task.id)}
              className="p-1.5 text-gray-400 dark:text-[#484F58] hover:text-blue-400 transition-colors cursor-pointer rounded"
              title="Carry to tomorrow"
            >
              <ArrowRight size={13} />
            </button>
          )}
          <button
            onClick={() => onRunAsWorktree?.(task)}
            disabled={!task.project_id}
            className="p-1.5 text-gray-400 dark:text-[#484F58] hover:text-purple-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer rounded"
            title={task.project_id ? 'Run as worktree' : 'Assign a project first'}
          >
            <GitBranchPlus size={13} />
          </button>
          {task.worktree_status === 'active' && (
            <button
              onClick={() => onCleanupWorktree?.(task)}
              className="p-1.5 text-gray-400 dark:text-[#484F58] hover:text-amber-400 transition-colors cursor-pointer rounded"
              title="Clean up worktree"
            >
              <FolderX size={13} />
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 text-gray-400 dark:text-[#484F58] hover:text-gray-700 dark:hover:text-[#E6EDF3] transition-colors cursor-pointer rounded"
            title="Toggle notes"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            onClick={() => onDelete(task.id)}
            className="p-1.5 text-gray-400 dark:text-[#484F58] hover:text-red-400 transition-colors cursor-pointer rounded"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Notes panel */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100 dark:border-[#21262D] pt-2">
          <TaskNotes
            task={task}
            onSave={(notes) => onNotesUpdate(task.id, notes)}
            onProjectChange={onProjectChange ? (pid) => onProjectChange(task.id, pid) : undefined}
          />
        </div>
      )}
    </div>
  );
};
