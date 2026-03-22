import React from 'react';
import { format } from 'date-fns';
import { Sun, Moon } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatCountdown } from '../../lib/time';
import { AiProviderSelector } from '../AiProviderSelector';

export const TopBar: React.FC = () => {
  const { sessionInfo, currentDate } = useSessionStore();
  const { settings, setTheme } = useSettingsStore();

  const isDark = settings?.theme === 'dark';

  const displayDate = currentDate
    ? format(new Date(currentDate + 'T00:00:00'), 'EEE, MMM d')
    : format(new Date(), 'EEE, MMM d');

  return (
    <div className="h-11 flex items-center justify-between px-4 border-b border-[#E2E8F0] bg-[#F8FAFC] dark:border-[#1E293B] dark:bg-[#0F172A] shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">{displayDate}</span>
        {sessionInfo && (
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: sessionInfo.phaseColor }}
            />
            <span className="text-xs font-medium" style={{ color: sessionInfo.phaseColor }}>
              {sessionInfo.phaseLabel}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {sessionInfo && sessionInfo.phase !== 'off' && sessionInfo.phase !== 'end_of_day' && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#64748B] dark:text-[#64748B]">{sessionInfo.nextEventLabel} in</span>
            <span className="font-mono font-medium text-[#111827] dark:text-[#E5E7EB]">
              {formatCountdown(sessionInfo.timeUntilNext)}
            </span>
          </div>
        )}

        <span className="text-[#CBD5E1] dark:text-[#334155] select-none">|</span>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          className="p-1.5 rounded-[10px] text-[#64748B] hover:text-[#111827] hover:bg-[#F1F5F9] dark:text-[#94A3B8] dark:hover:text-[#E5E7EB] dark:hover:bg-[#1E293B] transition-colors cursor-pointer"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        <span className="text-[#CBD5E1] dark:text-[#334155] select-none">|</span>

        <AiProviderSelector />
      </div>
    </div>
  );
};
