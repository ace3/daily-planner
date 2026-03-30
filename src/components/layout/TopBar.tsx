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
      className={`flex items-center justify-between border-b border-[#D2D2D7] bg-white dark:border-[#3A3A3C] dark:bg-[#2C2C2E] shrink-0
        ${mobileMode ? 'h-14 px-4' : 'h-11 px-4'}`}
    >
      <div className="flex items-center gap-3">
        <span className={`font-medium text-[#6E6E73] dark:text-[#AEAEB2] ${mobileMode ? 'text-sm' : 'text-xs'}`}>
          {displayDate}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {!mobileMode && <span className="text-[#D2D2D7] dark:text-[#48484A] select-none mx-1">|</span>}

        {/* Sync button */}
        <button
          onClick={handleForceSync}
          disabled={syncing}
          className={`rounded-[8px] transition-all duration-150 cursor-pointer flex items-center gap-1.5
            ${mobileMode
              ? 'p-2.5 min-h-[44px] min-w-[44px] justify-center'
              : 'p-1.5'
            }
            ${syncing
              ? 'text-[#0071E3] dark:text-[#409CFF] opacity-70 cursor-wait'
              : 'text-[#6E6E73] hover:text-[#1D1D1F] hover:bg-[#F5F5F7] dark:text-[#AEAEB2] dark:hover:text-[#F5F5F7] dark:hover:bg-[#3A3A3C]'
            }`}
          title={lastSyncedAt ? `Last synced ${formatDistanceToNow(lastSyncedAt, { addSuffix: true })}` : 'Sync now'}
        >
          <RefreshCw size={mobileMode ? 18 : 14} strokeWidth={1.5} className={syncing ? 'animate-spin' : ''} />
          {!mobileMode && lastSyncedAt && (
            <span className="text-[10px] text-[#AEAEB2] dark:text-[#6E6E73]">
              {formatDistanceToNow(lastSyncedAt, { addSuffix: true })}
            </span>
          )}
        </button>

        {/* Mobile mode toggle */}
        <button
          onClick={toggleMobileMode}
          className={`rounded-[8px] transition-all duration-150 cursor-pointer
            ${mobileMode
              ? 'p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#0071E3] bg-[#E3F0FF] dark:text-[#409CFF] dark:bg-[rgba(64,156,255,0.12)]'
              : 'p-1.5 text-[#6E6E73] hover:text-[#1D1D1F] hover:bg-[#F5F5F7] dark:text-[#AEAEB2] dark:hover:text-[#F5F5F7] dark:hover:bg-[#3A3A3C]'
            }`}
          title={mobileMode ? 'Switch to desktop mode' : 'Switch to mobile mode'}
        >
          {mobileMode ? <Monitor size={18} strokeWidth={1.5} /> : <Smartphone size={14} strokeWidth={1.5} />}
        </button>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          className={`rounded-[8px] transition-all duration-150 cursor-pointer
            ${mobileMode
              ? 'p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#6E6E73] hover:text-[#1D1D1F] hover:bg-[#F5F5F7] dark:text-[#AEAEB2] dark:hover:text-[#F5F5F7] dark:hover:bg-[#3A3A3C]'
              : 'p-1.5 text-[#6E6E73] hover:text-[#1D1D1F] hover:bg-[#F5F5F7] dark:text-[#AEAEB2] dark:hover:text-[#F5F5F7] dark:hover:bg-[#3A3A3C]'
            }`}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun size={mobileMode ? 18 : 14} strokeWidth={1.5} /> : <Moon size={mobileMode ? 18 : 14} strokeWidth={1.5} />}
        </button>

        {!mobileMode && <span className="text-[#D2D2D7] dark:text-[#48484A] select-none mx-1">|</span>}

        <AiProviderSelector mobileOptimized={mobileMode} />
      </div>
    </div>
  );
};
