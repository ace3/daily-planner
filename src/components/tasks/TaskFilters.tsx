import React from 'react';
import type { TaskStatus, TaskType } from '../../types/task';

interface TaskFiltersProps {
  statusFilter: TaskStatus | 'all';
  typeFilter: TaskType | 'all';
  onStatusChange: (s: TaskStatus | 'all') => void;
  onTypeChange: (t: TaskType | 'all') => void;
}

export const TaskFilters: React.FC<TaskFiltersProps> = ({
  statusFilter,
  typeFilter,
  onStatusChange,
  onTypeChange,
}) => {
  const statuses: Array<{ value: TaskStatus | 'all'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'todo', label: 'To-Do' },
    { value: 'in_progress', label: 'Active' },
    { value: 'review', label: 'Review' },
    { value: 'skipped', label: 'Skipped' },
  ];

  const types: Array<{ value: TaskType | 'all'; label: string }> = [
    { value: 'all', label: 'All types' },
    { value: 'research', label: 'Research' },
    { value: 'prompt', label: 'Prompt' },
    { value: 'meeting', label: 'Meeting' },
    { value: 'review', label: 'Review' },
    { value: 'other', label: 'Other' },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {statuses.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onStatusChange(value)}
            className={`px-2 py-0.5 rounded text-xs font-medium cursor-pointer transition-colors
              ${statusFilter === value
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-[#484F58] hover:text-[#8B949E]'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {types.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onTypeChange(value)}
            className={`px-2 py-0.5 rounded text-xs font-medium cursor-pointer transition-colors
              ${typeFilter === value
                ? 'bg-purple-500/20 text-purple-400'
                : 'text-[#484F58] hover:text-[#8B949E]'}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};
