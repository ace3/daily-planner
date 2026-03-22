import React from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { formatCountdown, formatDisplayTime } from '../../lib/time';

export const SessionTimer: React.FC = () => {
  const { sessionInfo } = useSessionStore();
  if (!sessionInfo) return null;

  const isWarning = sessionInfo.phase === 'session1_warning' || sessionInfo.phase === 'session2_warning';
  const isReset = sessionInfo.phase === 'session2';

  return (
    <div className={`
      rounded-xl border p-4 transition-colors duration-300
      ${isWarning ? 'border-amber-500/40 bg-amber-500/5' :
        isReset ? 'border-emerald-500/40 bg-emerald-500/5' :
        'border-[#30363D] bg-[#161B22]'}
    `}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: sessionInfo.phaseColor }}
          />
          <span className="text-xs font-semibold uppercase tracking-wider text-[#8B949E]">
            {sessionInfo.phaseLabel}
          </span>
        </div>
        <span className="text-xs text-[#484F58]">
          next: {formatDisplayTime(sessionInfo.nextEventTime)}
        </span>
      </div>

      {/* Countdown */}
      <div className="text-center py-2">
        <div className={`font-mono text-3xl font-bold tabular-nums ${isWarning ? 'text-amber-400' : 'text-[#E6EDF3]'}`}>
          {formatCountdown(sessionInfo.timeUntilNext)}
        </div>
        <div className="text-xs text-[#484F58] mt-1">until {sessionInfo.nextEventLabel}</div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 bg-[#21262D] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{
            width: `${sessionInfo.progress}%`,
            backgroundColor: sessionInfo.phaseColor,
          }}
        />
      </div>

      {/* Session timeline */}
      <div className="mt-3 grid grid-cols-3 text-center text-xs text-[#484F58]">
        <div>
          <div className="font-medium text-[#8B949E]">{formatDisplayTime(sessionInfo.session1Start)}</div>
          <div>Kickstart</div>
        </div>
        <div>
          <div className="font-medium text-[#8B949E]">{formatDisplayTime(sessionInfo.session2Start)}</div>
          <div>Fresh Session</div>
        </div>
        <div>
          <div className="font-medium text-[#8B949E]">{formatDisplayTime(sessionInfo.endOfDay)}</div>
          <div>End of Day</div>
        </div>
      </div>
    </div>
  );
};
