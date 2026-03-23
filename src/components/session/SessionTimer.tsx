import React from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useMobileStore } from '../../stores/mobileStore';
import { formatCountdown, formatDisplayTime } from '../../lib/time';

export const SessionTimer: React.FC = () => {
  const { sessionInfo } = useSessionStore();
  const { mobileMode: m } = useMobileStore();
  if (!sessionInfo) return null;

  const isWarning = sessionInfo.phase === 'session1_warning' || sessionInfo.phase === 'session2_warning';
  const isReset = sessionInfo.phase === 'session2';

  return (
    <div className={`
      rounded-xl border transition-colors duration-300
      ${isWarning ? 'border-amber-500/40 bg-amber-500/5' :
        isReset ? 'border-emerald-500/40 bg-emerald-500/5' :
        'border-gray-200 dark:border-[#30363D] bg-white dark:bg-[#161B22]'}
      ${m ? 'p-5' : 'p-4'}
    `}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={`rounded-full ${m ? 'w-3 h-3' : 'w-2.5 h-2.5'}`}
            style={{ backgroundColor: sessionInfo.phaseColor }}
          />
          <span className={`font-semibold uppercase tracking-wider text-gray-500 dark:text-[#8B949E] ${m ? 'text-sm' : 'text-xs'}`}>
            {sessionInfo.phaseLabel}
          </span>
        </div>
        <span className={`text-gray-500 dark:text-[#484F58] ${m ? 'text-sm' : 'text-xs'}`}>
          next: {formatDisplayTime(sessionInfo.nextEventTime)}
        </span>
      </div>

      {/* Countdown */}
      <div className="text-center py-2">
        <div className={`font-mono font-bold tabular-nums ${isWarning ? 'text-amber-400' : 'text-gray-900 dark:text-[#E6EDF3]'} ${m ? 'text-4xl' : 'text-3xl'}`}>
          {formatCountdown(sessionInfo.timeUntilNext)}
        </div>
        <div className={`text-gray-500 dark:text-[#484F58] mt-1 ${m ? 'text-sm' : 'text-xs'}`}>until {sessionInfo.nextEventLabel}</div>
      </div>

      {/* Progress bar */}
      <div className={`mt-3 bg-gray-100 dark:bg-[#21262D] rounded-full overflow-hidden ${m ? 'h-2.5' : 'h-1.5'}`}>
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{
            width: `${sessionInfo.progress}%`,
            backgroundColor: sessionInfo.phaseColor,
          }}
        />
      </div>

      {/* Session timeline */}
      <div className={`mt-3 grid grid-cols-3 text-center text-gray-500 dark:text-[#484F58] ${m ? 'text-sm' : 'text-xs'}`}>
        <div>
          <div className={`font-medium text-gray-600 dark:text-[#8B949E] ${m ? 'text-base' : ''}`}>{formatDisplayTime(sessionInfo.session1Start)}</div>
          <div>Kickstart</div>
        </div>
        <div>
          <div className={`font-medium text-gray-600 dark:text-[#8B949E] ${m ? 'text-base' : ''}`}>{formatDisplayTime(sessionInfo.session2Start)}</div>
          <div>Fresh Session</div>
        </div>
        <div>
          <div className={`font-medium text-gray-600 dark:text-[#8B949E] ${m ? 'text-base' : ''}`}>{formatDisplayTime(sessionInfo.endOfDay)}</div>
          <div>End of Day</div>
        </div>
      </div>
    </div>
  );
};
