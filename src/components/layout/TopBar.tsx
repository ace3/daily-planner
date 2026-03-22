import React from 'react';
import { format } from 'date-fns';
import { Sun, Moon } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatCountdown } from '../../lib/time';

export const TopBar: React.FC = () => {
  const { sessionInfo, currentDate } = useSessionStore();
  const { claudeAvailable, opencodeAvailable } = useProviderStore();
  const { settings, setTheme } = useSettingsStore();
  const activeProvider = settings?.ai_provider ?? 'claude';

  const isDark = settings?.theme === 'dark';

  const displayDate = currentDate
    ? format(new Date(currentDate + 'T00:00:00'), 'EEE, MMM d')
    : format(new Date(), 'EEE, MMM d');

  return (
    <div className="h-11 flex items-center justify-between px-4 border-b border-gray-100 bg-white dark:border-[#21262D] dark:bg-[#0F1117] shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-gray-500 dark:text-[#8B949E]">{displayDate}</span>
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
            <span className="text-gray-400 dark:text-[#484F58]">{sessionInfo.nextEventLabel} in</span>
            <span className="font-mono font-medium text-gray-900 dark:text-[#E6EDF3]">
              {formatCountdown(sessionInfo.timeUntilNext)}
            </span>
          </div>
        )}

        <span className="text-gray-300 dark:text-[#30363D] select-none">|</span>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-[#484F58] dark:hover:text-[#E6EDF3] dark:hover:bg-[#21262D] transition-colors cursor-pointer"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        <span className="text-gray-300 dark:text-[#30363D] select-none">|</span>

        {/* CLI status badges */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: claudeAvailable ? '#3FB950' : '#484F58' }}
            />
            <span className={`text-xs ${activeProvider === 'claude' ? 'text-gray-900 dark:text-[#E6EDF3]' : 'text-gray-500 dark:text-[#8B949E]'}`}>
              Claude
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: opencodeAvailable ? '#3FB950' : '#484F58' }}
            />
            <span className={`text-xs ${activeProvider === 'opencode' ? 'text-gray-900 dark:text-[#E6EDF3]' : 'text-gray-500 dark:text-[#8B949E]'}`}>
              OpenCode
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
