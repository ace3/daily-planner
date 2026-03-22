import React from 'react';
import { format } from 'date-fns';
import { useSessionStore } from '../../stores/sessionStore';
import { formatCountdown } from '../../lib/time';

export const TopBar: React.FC = () => {
  const { sessionInfo, currentDate } = useSessionStore();

  const displayDate = currentDate
    ? format(new Date(currentDate + 'T00:00:00'), 'EEE, MMM d')
    : format(new Date(), 'EEE, MMM d');

  return (
    <div className="h-11 flex items-center justify-between px-4 border-b border-[#21262D] bg-[#0F1117] shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-[#8B949E]">{displayDate}</span>
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

      {sessionInfo && sessionInfo.phase !== 'off' && sessionInfo.phase !== 'end_of_day' && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#484F58]">{sessionInfo.nextEventLabel} in</span>
          <span className="font-mono font-medium text-[#E6EDF3]">
            {formatCountdown(sessionInfo.timeUntilNext)}
          </span>
        </div>
      )}
    </div>
  );
};
