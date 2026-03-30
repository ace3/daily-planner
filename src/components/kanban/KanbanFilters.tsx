import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Project } from '../../types/project';

export interface KanbanFilters {
  projectId?: string;
  priority?: number;
  agent?: string;
  search?: string;
}

interface KanbanFiltersProps {
  projects: Project[];
  onFilterChange: (filters: KanbanFilters) => void;
  showProjectFilter?: boolean;
}

const PRIORITY_OPTIONS = [
  { label: 'All Priorities', value: '' },
  { label: 'High',           value: '1' },
  { label: 'Medium',         value: '2' },
  { label: 'Low',            value: '3' },
];

const AGENT_OPTIONS = [
  { label: 'All Agents',  value: '' },
  { label: 'Claude',      value: 'claude' },
  { label: 'Codex',       value: 'codex' },
  { label: 'OpenCode',    value: 'opencode' },
  { label: 'Copilot',     value: 'copilot' },
];

const selectClass =
  'h-8 rounded-lg border border-gray-200 bg-white text-[13px] text-gray-700 px-2.5 pr-7 focus:outline-none focus:ring-2 focus:ring-blue-300 appearance-none cursor-pointer shadow-sm dark:border-[#30363D] dark:bg-[#161B22] dark:text-[#E6EDF3]';

const KanbanFilters: React.FC<KanbanFiltersProps> = ({
  projects,
  onFilterChange,
  showProjectFilter = true,
}) => {
  const [filters, setFilters] = useState<KanbanFilters>({});

  function update(patch: Partial<KanbanFilters>) {
    const next = { ...filters, ...patch };
    // Strip empty strings so callers can check `filters.projectId` truthiness
    if (next.projectId === '') delete next.projectId;
    if (next.agent === '') delete next.agent;
    if (next.priority === 0) delete next.priority;
    setFilters(next);
    onFilterChange(next);
  }

  function clearAll() {
    setFilters({});
    onFilterChange({});
  }

  const hasFilters =
    !!filters.projectId ||
    !!filters.priority ||
    !!filters.agent ||
    !!filters.search;

  return (
    <div className="flex flex-wrap items-center gap-2 py-3">
      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
        <input
          type="text"
          placeholder="Search tasks…"
          value={filters.search ?? ''}
          onChange={(e) => update({ search: e.target.value || undefined })}
          className="h-8 rounded-lg border border-gray-200 bg-white text-[13px] text-gray-700 pl-7 pr-3 w-44 focus:outline-none focus:ring-2 focus:ring-blue-300 shadow-sm dark:border-[#30363D] dark:bg-[#161B22] dark:text-[#E6EDF3]"
        />
      </div>

      {/* Project filter */}
      {showProjectFilter && (
        <div className="relative">
          <select
            value={filters.projectId ?? ''}
            onChange={(e) => update({ projectId: e.target.value })}
            className={selectClass}
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-[10px]">▾</span>
        </div>
      )}

      {/* Priority filter */}
      <div className="relative">
        <select
          value={filters.priority?.toString() ?? ''}
          onChange={(e) =>
            update({ priority: e.target.value ? Number(e.target.value) : undefined })
          }
          className={selectClass}
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-[10px]">▾</span>
      </div>

      {/* Agent filter */}
      <div className="relative">
        <select
          value={filters.agent ?? ''}
          onChange={(e) => update({ agent: e.target.value })}
          className={selectClass}
        >
          {AGENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-[10px]">▾</span>
      </div>

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-[13px] text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-[#21262D] transition-colors"
        >
          <X size={12} />
          Clear
        </button>
      )}
    </div>
  );
};

export default KanbanFilters;
