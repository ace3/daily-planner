import React from 'react';
import { format } from 'date-fns';
import { Sun, Moon, Smartphone, Monitor } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMobileStore } from '../../stores/mobileStore';
import { formatCountdown } from '../../lib/time';
import { AiProviderSelector } from '../AiProviderSelector';

export const TopBar: React.FC = () => {
  const { sessionInfo, currentDate } = useSessionStore();
  const { settings, setTheme } = useSettingsStore();
  const { mobileMode, toggleMobileMode } = useMobileStore();

  const isDark = settings?.theme === 'dark';

  const displayDate = currentDate
    ? format(new Date(currentDate + 'T00:00:00'), 'EEE, MMM d')
    : format(new Date(), 'EEE, MMM d');

  return (
    <div
      className={`flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] dark:border-[#1E293B] dark:bg-[#0F172A] shrink-0
        ${mobileMode ? 'h-14 px-4' : 'h-11 px-4'}`}
    >
      <div className="flex items-center gap-3">
        <span className={`font-medium text-[#64748B] dark:text-[#94A3B8] ${mobileMode ? 'text-sm' : 'text-xs'}`}>
          {displayDate}
        </span>
        {sessionInfo && (
          <div className="flex items-center gap-2">
            <div
              className={`rounded-full animate-pulse ${mobileMode ? 'w-2.5 h-2.5' : 'w-2 h-2'}`}
              style={{ backgroundColor: sessionInfo.phaseColor }}
            />
            <span
              className={`font-medium ${mobileMode ? 'text-sm' : 'text-xs'}`}
              style={{ color: sessionInfo.phaseColor }}
            >
              {sessionInfo.phaseLabel}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {sessionInfo && sessionInfo.phase !== 'off' && sessionInfo.phase !== 'end_of_day' && !mobileMode && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#64748B] dark:text-[#64748B]">{sessionInfo.nextEventLabel} in</span>
            <span className="font-mono font-medium text-[#111827] dark:text-[#E5E7EB]">
              {formatCountdown(sessionInfo.timeUntilNext)}
            </span>
          </div>
        )}

        {!mobileMode && <span className="text-[#CBD5E1] dark:text-[#334155] select-none">|</span>}

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
