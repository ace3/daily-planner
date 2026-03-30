import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TaskStatus } from '../../types/task';

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: { id: string }[];
  children: React.ReactNode;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; chipClass: string; dotClass: string }
> = {
  todo:        { label: 'To-Do',      chipClass: 'bg-gray-200 text-gray-600 dark:bg-gray-700/70 dark:text-gray-200', dotClass: 'bg-gray-400 dark:bg-gray-300' },
  improved:    { label: 'Improved',   chipClass: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300', dotClass: 'bg-purple-400 dark:bg-purple-300' },
  planned:     { label: 'Planned',    chipClass: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300', dotClass: 'bg-blue-400 dark:bg-blue-300' },
  in_progress: { label: 'In Progress',chipClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', dotClass: 'bg-amber-400 dark:bg-amber-300' },
  review:      { label: 'Review',     chipClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dotClass: 'bg-emerald-500 dark:bg-emerald-400' },
  done:        { label: 'Done',       chipClass: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', dotClass: 'bg-green-500 dark:bg-green-400' },
};

const KanbanColumn: React.FC<KanbanColumnProps> = ({ status, tasks, children }) => {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    chipClass: 'bg-gray-200 text-gray-600 dark:bg-gray-700/70 dark:text-gray-200',
    dotClass: 'bg-gray-400 dark:bg-gray-300',
  };

  const { setNodeRef, isOver } = useDroppable({ id: status });

  const taskIds = tasks.map((t) => t.id);

  return (
    <div
      className="flex-shrink-0 flex flex-col"
      style={{ width: 280 }}
    >
      {/* Sticky column header */}
      <div className="sticky top-0 z-10 pb-2 bg-[#F5F5F7] dark:bg-[#0F1117]">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${config.dotClass}`} />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {config.label}
          </span>
          <span
            className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${config.chipClass}`}
          >
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Droppable + Sortable card list */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`
            flex-1 rounded-xl p-3 overflow-y-auto flex flex-col gap-2 min-h-[120px]
            transition-colors
            ${isOver ? 'ring-2 ring-blue-300 bg-blue-50/40 dark:bg-blue-900/20 dark:ring-blue-700' : 'bg-[#EFEFEF] dark:bg-[#161B22]'}
          `}
          style={{ maxHeight: 'calc(100vh - 200px)' }}
        >
          {children}

          {/* Empty state */}
          {tasks.length === 0 && (
            <div
              className={`
                flex items-center justify-center rounded-lg
                border-2 border-dashed
                text-[12px] text-gray-400 dark:text-gray-500 font-medium
                min-h-[80px]
                ${isOver ? 'border-blue-300 text-blue-400 dark:border-blue-600 dark:text-blue-300' : 'border-gray-300 dark:border-gray-700'}
              `}
            >
              Drop here
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
};

export default KanbanColumn;
