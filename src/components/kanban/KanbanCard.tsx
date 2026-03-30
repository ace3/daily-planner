import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, CheckCircle2, Bot } from 'lucide-react';
import { Task } from '../../types/task';
import { format, isPast, differenceInDays } from 'date-fns';

interface KanbanCardProps {
  task: Task;
  onClick?: () => void;
  isDragging?: boolean;
}

function priorityDotClass(priority: number): string {
  if (priority === 1) return 'text-red-500';
  if (priority === 2) return 'text-amber-500';
  return 'text-green-500';
}

function agentLabel(agent: string): string {
  switch (agent) {
    case 'claude': return 'Claude';
    case 'codex': return 'Codex';
    case 'opencode': return 'OpenCode';
    case 'copilot': return 'Copilot';
    default: return agent;
  }
}

function DeadlineBadge({ deadline }: { deadline: string }) {
  const date = new Date(deadline);
  const past = isPast(date);
  const daysUntil = differenceInDays(date, new Date());
  const soon = !past && daysUntil <= 3;

  const cls = past
    ? 'text-red-500'
    : soon
    ? 'text-amber-500'
    : 'text-gray-400 dark:text-gray-500';

  return (
    <span className={`text-[11px] font-medium ${cls}`}>
      Due: {format(date, 'MMM d')}
    </span>
  );
}

// Sortable wrapper used in KanbanBoard
export const SortableKanbanCard: React.FC<KanbanCardProps & { id: string }> = ({
  id,
  task,
  onClick,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 999 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <KanbanCard
        task={task}
        onClick={onClick}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
};

interface KanbanCardInternalProps extends KanbanCardProps {
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
}

export const KanbanCard: React.FC<KanbanCardInternalProps> = ({
  task,
  onClick,
  isDragging,
  dragHandleProps,
}) => {
  return (
    <div
      onClick={onClick}
      className={`
        relative bg-white dark:bg-[#0F1117] border border-gray-200 dark:border-[#30363D] rounded-[10px] p-3 cursor-pointer group
        shadow-[0_1px_3px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]
        hover:shadow-[0_2px_6px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.08)]
        transition-shadow select-none
        ${isDragging ? 'shadow-[0_8px_24px_rgba(0,0,0,0.15)]' : ''}
      `}
    >
      {/* Drag handle — visible on hover */}
      {dragHandleProps && (
        <button
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing p-0.5"
          aria-label="Drag task"
        >
          <GripVertical size={14} />
        </button>
      )}

      {/* Title row with priority dot */}
      <div className="flex items-start gap-1.5 pr-5">
        <span
          className={`mt-[3px] text-[10px] leading-none shrink-0 ${priorityDotClass(task.priority)}`}
          aria-label={`Priority ${task.priority}`}
        >
          ●
        </span>
        <p className="text-[15px] font-semibold text-gray-800 dark:text-[#E6EDF3] leading-snug line-clamp-2 flex-1">
          {task.title}
        </p>
        {/* Approved badge */}
        {task.review_status === 'approved' && (
          <CheckCircle2 size={14} className="text-green-500 shrink-0 mt-0.5" />
        )}
      </div>

      {/* Description preview */}
      {task.description && (
        <p className="text-[13px] text-gray-400 dark:text-gray-500 mt-1 leading-snug line-clamp-1">
          {task.description}
        </p>
      )}

      {/* Bottom row */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {/* Agent badge */}
        {task.agent && (
          <span className="flex items-center gap-1 text-[11px] bg-gray-100 text-gray-500 dark:bg-[#21262D] dark:text-gray-300 px-1.5 py-0.5 rounded-full">
            <Bot size={10} />
            {agentLabel(task.agent)}
          </span>
        )}

        {/* Deadline */}
        {task.deadline && <DeadlineBadge deadline={task.deadline} />}
      </div>
    </div>
  );
};

export default KanbanCard;
