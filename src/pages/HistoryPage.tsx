import React, { useEffect, useMemo, useState } from 'react';
import { History, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { getTasksRange } from '../lib/tauri';
import { useSettingsStore } from '../stores/settingsStore';
import { useProjectStore } from '../stores/projectStore';
import { getLocalDate } from '../lib/time';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import type { Task } from '../types/task';

const STATUS_COLORS: Record<string, string> = {
  done: 'text-green-400',
  pending: 'text-yellow-400',
  in_progress: 'text-blue-400',
  skipped: 'text-gray-500',
  carried_over: 'text-purple-400',
};

const STATUS_LABELS: Record<string, string> = {
  done: 'Done',
  pending: 'Pending',
  in_progress: 'In Progress',
  skipped: 'Skipped',
  carried_over: 'Carried Over',
};

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const TaskHistoryCard: React.FC<{ task: Task; projectName?: string }> = ({ task, projectName }) => {
  const [expanded, setExpanded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const hasPromptData = task.prompt_used || task.prompt_result;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-[#30363D] bg-white dark:bg-[#161B22] p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-900 dark:text-[#E6EDF3]">{task.title}</span>
            <Badge variant="gray">{task.task_type}</Badge>
            <span className={`text-[11px] font-medium ${STATUS_COLORS[task.status] ?? 'text-gray-400'}`}>
              {STATUS_LABELS[task.status] ?? task.status}
            </span>
            {projectName && <Badge variant="blue">{projectName}</Badge>}
          </div>
          {task.notes && (
            <p className="text-xs text-gray-500 dark:text-[#8B949E] mt-1 line-clamp-2">{task.notes}</p>
          )}
          {task.completed_at && (
            <p className="text-[11px] text-gray-400 dark:text-[#484F58] mt-0.5">
              Completed: {new Date(task.completed_at).toLocaleString()}
            </p>
          )}
        </div>
        {hasPromptData && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-[#21262D] cursor-pointer text-gray-400"
            title={expanded ? 'Collapse' : 'Show prompts'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {expanded && hasPromptData && (
        <div className="mt-3 space-y-2 border-t border-gray-100 dark:border-[#21262D] pt-2">
          {task.prompt_used && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-gray-500 dark:text-[#8B949E] uppercase tracking-wide">Prompt Used</span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={copiedField === 'used' ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                  onClick={() => handleCopy(task.prompt_used!, 'used')}
                  className={`text-[10px] ${copiedField === 'used' ? 'text-green-400' : ''}`}
                >
                  {copiedField === 'used' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre className="rounded bg-gray-50 dark:bg-[#0F1117] border border-gray-200 dark:border-[#21262D] p-2 text-[11px] text-gray-700 dark:text-[#8B949E] font-mono whitespace-pre-wrap overflow-y-auto max-h-40">
                {task.prompt_used}
              </pre>
            </div>
          )}
          {task.prompt_result && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-green-500 dark:text-green-400 uppercase tracking-wide">Improved Prompt</span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={copiedField === 'result' ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                  onClick={() => handleCopy(task.prompt_result!, 'result')}
                  className={`text-[10px] ${copiedField === 'result' ? 'text-green-400' : ''}`}
                >
                  {copiedField === 'result' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre className="rounded bg-green-50 dark:bg-green-500/5 border border-green-200 dark:border-green-500/20 p-2 text-[11px] text-gray-700 dark:text-[#E6EDF3] font-mono whitespace-pre-wrap overflow-y-auto max-h-40">
                {task.prompt_result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const HistoryPage: React.FC = () => {
  const { settings } = useSettingsStore();
  const { projects } = useProjectStore();
  const today = getLocalDate(settings?.timezone_offset ?? 7);

  // Default range: last 7 days
  const [rangeTo, setRangeTo] = useState(today);
  const [rangeFrom, setRangeFrom] = useState(() => addDays(today, -6));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getTasksRange(rangeFrom, rangeTo)
      .then(setTasks)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [rangeFrom, rangeTo]);

  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  // Group tasks by date
  const tasksByDate = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const t of tasks) {
      const existing = groups.get(t.date) ?? [];
      existing.push(t);
      groups.set(t.date, existing);
    }
    // Sort dates descending
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [tasks]);

  const shiftRange = (days: number) => {
    setRangeFrom((f) => addDays(f, days));
    setRangeTo((t) => addDays(t, days));
  };

  const goToThisWeek = () => {
    setRangeTo(today);
    setRangeFrom(addDays(today, -6));
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col p-4 gap-4">
      <div className="flex items-center gap-3">
        <History size={16} className="text-gray-500 dark:text-[#8B949E]" />
        <h1 className="text-base font-semibold text-gray-900 dark:text-[#E6EDF3]">History</h1>
      </div>

      {/* Date range controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" icon={<ChevronLeft size={14} />} onClick={() => shiftRange(-7)}>
          Prev week
        </Button>
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value)}
            className="bg-white dark:bg-[#161B22] border border-gray-200 dark:border-[#30363D] rounded-lg text-xs px-2 py-1.5 text-gray-900 dark:text-[#E6EDF3] outline-none"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value)}
            className="bg-white dark:bg-[#161B22] border border-gray-200 dark:border-[#30363D] rounded-lg text-xs px-2 py-1.5 text-gray-900 dark:text-[#E6EDF3] outline-none"
          />
        </div>
        <Button variant="ghost" size="sm" icon={<ChevronRight size={14} />} onClick={() => shiftRange(7)}>
          Next week
        </Button>
        {rangeTo !== today && (
          <Button variant="ghost" size="sm" onClick={goToThisWeek}>
            This week
          </Button>
        )}
        <span className="text-[11px] text-gray-400 dark:text-[#484F58] ml-auto">
          {tasks.length} task{tasks.length !== 1 ? 's' : ''} found
        </span>
      </div>

      {loading && (
        <div className="text-xs text-gray-500 dark:text-[#8B949E]">Loading…</div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">{error}</div>
      )}

      {!loading && tasksByDate.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500 dark:text-[#8B949E]">No tasks found in this date range.</p>
        </div>
      )}

      {tasksByDate.map(([date, dateTasks]) => {
        const doneCount = dateTasks.filter((t) => t.status === 'done').length;
        return (
          <div key={date} className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">{formatDate(date)}</h2>
              <span className="text-[11px] text-gray-400 dark:text-[#484F58]">
                {dateTasks.length} task{dateTasks.length !== 1 ? 's' : ''} · {doneCount} done
              </span>
            </div>
            <div className="space-y-1.5">
              {dateTasks.map((task) => (
                <TaskHistoryCard
                  key={task.id}
                  task={task}
                  projectName={task.project_id ? projectMap.get(task.project_id) : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
