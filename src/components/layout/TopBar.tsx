import React from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Sun, Moon, Smartphone, Monitor, RefreshCw } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMobileStore } from '../../stores/mobileStore';
import { useTaskStore } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSyncStore } from '../../stores/syncStore';
import { AiProviderSelector } from '../AiProviderSelector';

export const TopBar: React.FC = () => {
  const { settings, setTheme, fetchSettings } = useSettingsStore();
  const { mobileMode, toggleMobileMode } = useMobileStore();
  const { fetchTasks } = useTaskStore();
  const { fetchProjects } = useProjectStore();
  const { syncing, lastSyncedAt, syncAll } = useSyncStore();

  const handleForceSync = () => {
    syncAll(fetchTasks, fetchSettings, fetchProjects);
  };

  const isDark = settings?.theme === 'dark';

  const displayDate = format(new Date(), 'EEE, MMM d');

  return (
    <div
      className={`flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] dark:border-[#1E293B] dark:bg-[#0F172A] shrink-0
        ${mobileMode ? 'h-14 px-4' : 'h-11 px-4'}`}
    >
      <div className="flex items-center gap-3">
        <span className={`font-medium text-[#64748B] dark:text-[#94A3B8] ${mobileMode ? 'text-sm' : 'text-xs'}`}>
          {displayDate}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {!mobileMode && <span className="text-[#CBD5E1] dark:text-[#334155] select-none">|</span>}

        {/* Sync button */}
        <button
          onClick={handleForceSync}
          disabled={syncing}
          className={`rounded-[10px] transition-colors cursor-pointer flex items-center gap-1.5
            ${mobileMode
              ? 'p-2.5 min-h-[44px] min-w-[44px] justify-center'
              : 'p-1.5'
            }
            ${syncing
              ? 'text-[#2563EB] dark:text-[#7DD3FC] opacity-70 cursor-wait'
              : 'text-[#64748B] hover:text-[#111827] hover:bg-[#F1F5F9] dark:text-[#94A3B8] dark:hover:text-[#E5E7EB] dark:hover:bg-[#1E293B]'
            }`}
          title={lastSyncedAt ? `Last synced ${formatDistanceToNow(lastSyncedAt, { addSuffix: true })}` : 'Sync now'}
        >
          <RefreshCw size={mobileMode ? 18 : 14} className={syncing ? 'animate-spin' : ''} />
          {!mobileMode && lastSyncedAt && (
            <span className="text-[10px] text-[#94A3B8] dark:text-[#475569]">
              {formatDistanceToNow(lastSyncedAt, { addSuffix: true })}
            </span>
          )}
        </button>

        {/* Mobile mode toggle */}
        <button
          onClick={toggleMobileMode}
          className={`rounded-[10px] transition-colors cursor-pointer
            ${mobileMode
              ? 'p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#2563EB] bg-blue-50 dark:text-[#7DD3FC] dark:bg-[rgba(125,211,252,0.12)]'
              : 'p-1.5 text-[#64748B] hover:text-[#111827] hover:bg-[#F1F5F9] dark:text-[#94A3B8] dark:hover:text-[#E5E7EB] dark:hover:bg-[#1E293B]'
            }`}
          title={mobileMode ? 'Switch to desktop mode' : 'Switch to mobile mode'}
        >
          {mobileMode ? <Monitor size={18} /> : <Smartphone size={14} />}
        </button>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          className={`rounded-[10px] transition-colors cursor-pointer
            ${mobileMode
              ? 'p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#64748B] hover:text-[#111827] hover:bg-[#F1F5F9] dark:text-[#94A3B8] dark:hover:text-[#E5E7EB] dark:hover:bg-[#1E293B]'
              : 'p-1.5 text-[#64748B] hover:text-[#111827] hover:bg-[#F1F5F9] dark:text-[#94A3B8] dark:hover:text-[#E5E7EB] dark:hover:bg-[#1E293B]'
            }`}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun size={mobileMode ? 18 : 14} /> : <Moon size={mobileMode ? 18 : 14} />}
        </button>

        {!mobileMode && <span className="text-[#CBD5E1] dark:text-[#334155] select-none">|</span>}

        <AiProviderSelector mobileOptimized={mobileMode} />
      </div>
    </div>
  );
};
