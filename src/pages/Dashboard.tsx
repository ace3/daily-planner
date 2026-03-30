import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useMobileStore } from '../stores/mobileStore';
import { useProjectStore } from '../stores/projectStore';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import { TaskCreationModal } from '../components/TaskCreationModal';
import { getLocalDate } from '../lib/time';
import { getTasksRange } from '../lib/tauri';

interface AppSummary {
  total: number;
  done: number;
  active: number;
  skipped: number;
}

export const Dashboard: React.FC = () => {
  const { mobileMode: m } = useMobileStore();
  const { projects, fetchProjects } = useProjectStore();
  const { tasks, fetchTasks } = useTaskStore();
  const { settings } = useSettingsStore();
  const navigate = useNavigate();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [appSummary, setAppSummary] = useState<AppSummary>({
    total: 0,
    done: 0,
    active: 0,
    skipped: 0,
  });

  useEffect(() => {
    fetchProjects();
    fetchTasks();
  }, [fetchProjects, fetchTasks]);

  useEffect(() => {
    let mounted = true;
    const today = getLocalDate(settings?.timezone_offset ?? 7);
    setSummaryLoading(true);

    getTasksRange('1970-01-01', today)
      .then((allTasks) => {
        if (!mounted) return;
        const total = allTasks.filter((t) => t.status !== 'carried_over').length;
        const done = allTasks.filter((t) => t.status === 'review' || (t.status as string) === 'done').length;
        const active = allTasks.filter((t) => t.status === 'todo' || t.status === 'in_progress').length;
        const skipped = allTasks.filter((t) => t.status === 'skipped').length;
        setAppSummary({ total, done, active, skipped });
      })
      .catch((e) => {
        console.error('Failed to load whole-app summary:', e);
      })
      .finally(() => {
        if (mounted) setSummaryLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [settings?.timezone_offset, tasks.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setIsCreateModalOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const appCompletionPct = appSummary.total > 0
    ? Math.round((appSummary.done / appSummary.total) * 100)
    : 0;

  return (
    <>
      <TaskCreationModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          fetchTasks();
        }}
      />

      <div className="flex flex-col h-full overflow-hidden bg-[#F5F5F7] dark:bg-[#0F1117]">
        <div className={`${m ? 'px-3 py-2' : 'px-4 py-3'} flex items-center justify-between shrink-0 bg-white border-b border-gray-200 dark:bg-[#161B22] dark:border-[#30363D]`}>
          <div className="flex items-center gap-3">
            <h1 className={`font-semibold text-gray-800 dark:text-[#E6EDF3] ${m ? 'text-base' : 'text-lg'}`}>
              Dashboard
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/projects')}
              className="text-sm text-blue-600 hover:underline px-2 py-1 dark:text-blue-400"
            >
              Projects
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className={`flex items-center gap-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors ${m ? 'h-9' : 'h-8'}`}
            >
              <Plus size={14} />
              New Task
            </button>
          </div>
        </div>

        <div className={`${m ? 'px-3 pt-3' : 'px-4 pt-3'} shrink-0`}>
          <div className="rounded-xl border border-gray-200 dark:border-[#30363D] bg-white dark:bg-[#161B22] p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-500 dark:text-[#8B949E] uppercase tracking-wide">
                Whole App Summary
              </div>
              {summaryLoading && (
                <span className="text-xs text-gray-400 dark:text-[#484F58]">Updating...</span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-lg border border-gray-100 dark:border-[#21262D] p-2">
                <div className="text-[11px] text-gray-500 dark:text-[#8B949E]">Total</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-[#E6EDF3]">{appSummary.total}</div>
              </div>
              <div className="rounded-lg border border-gray-100 dark:border-[#21262D] p-2">
                <div className="text-[11px] text-gray-500 dark:text-[#8B949E]">Done</div>
                <div className="text-lg font-semibold text-emerald-400">{appSummary.done}</div>
              </div>
              <div className="rounded-lg border border-gray-100 dark:border-[#21262D] p-2">
                <div className="text-[11px] text-gray-500 dark:text-[#8B949E]">Active</div>
                <div className="text-lg font-semibold text-amber-400">{appSummary.active}</div>
              </div>
              <div className="rounded-lg border border-gray-100 dark:border-[#21262D] p-2">
                <div className="text-[11px] text-gray-500 dark:text-[#8B949E]">Projects</div>
                <div className="text-lg font-semibold text-blue-400">{projects.length}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-500 dark:text-[#8B949E]">
              Completion: <span className="font-semibold text-gray-900 dark:text-[#E6EDF3]">{appCompletionPct}%</span>
              {' · '}
              Skipped: <span className="font-semibold text-gray-900 dark:text-[#E6EDF3]">{appSummary.skipped}</span>
            </div>
          </div>
        </div>

        <div className="flex-1" />
      </div>
    </>
  );
};
