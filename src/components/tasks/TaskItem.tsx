import React, { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  SkipForward,
  Trash2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  GripVertical,
  GitBranchPlus,
  FolderX,
} from 'lucide-react';
import { Badge } from '../ui/Badge';
import { TaskNotes } from './TaskNotes';
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
}) => {
  const [expanded, setExpanded] = useState(false);
  const isDone = task.status === 'done';
  const isSkipped = task.status === 'skipped';
  const isCarried = task.status === 'carried_over';

  return (
    <div
      className={`
        group rounded-lg border transition-colors duration-150
        ${isDone
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : isSkipped || isCarried
          ? 'border-gray-100 bg-gray-50 opacity-60 dark:border-[#21262D] dark:bg-[#0F1117]'
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
          onClick={() => onStatusChange(task.id, isDone ? 'pending' : 'done')}
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
                isDone || isSkipped ? 'line-through text-gray-400 dark:text-[#484F58]' : 'text-gray-900 dark:text-[#E6EDF3]'
              }`}
              onClick={() => onSelect?.(task)}
            >
              {task.title}
            </span>
            <span className={`text-xs ${priorityColors[task.priority]}`}>
              {priorityDots[task.priority]}
            </span>
            <Badge variant={typeColors[task.task_type] || 'gray'}>{task.task_type}</Badge>
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
          {!isDone && !isSkipped && !isCarried && (
            <button
              onClick={() => onStatusChange(task.id, 'skipped')}
              className="p-1.5 text-gray-400 dark:text-[#484F58] hover:text-amber-400 transition-colors cursor-pointer rounded"
              title="Skip"
            >
              <SkipForward size={13} />
            </button>
          )}
          {!isDone && !isCarried && (
            <button
              onClick={() => onCarryForward(task.id)}
              className="p-1.5 text-gray-400 dark:text-[#484F58] hover:text-blue-400 transition-colors cursor-pointer rounded"
              title="Carry to tomorrow"
            >
              <ArrowRight size={13} />
            </button>
          )}
          {!isCarried && (
            <button
              onClick={() => onRunAsWorktree?.(task)}
              disabled={!task.project_id}
              className="p-1.5 text-gray-400 dark:text-[#484F58] hover:text-purple-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer rounded"
              title={task.project_id ? 'Run as worktree' : 'Assign a project first'}
            >
              <GitBranchPlus size={13} />
            </button>
          )}
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
