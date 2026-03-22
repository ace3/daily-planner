import React from 'react';
import { AlertTriangle, Zap } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { formatCountdown } from '../../lib/time';

export const SessionWarning: React.FC = () => {
  const { sessionInfo } = useSessionStore();

  if (!sessionInfo) return null;

  const isWarning = sessionInfo.phase === 'session1_warning';
  const isReset = sessionInfo.phase === 'session2';
  const isEndWarning = sessionInfo.phase === 'session2_warning';

  if (!isWarning && !isReset && !isEndWarning) return null;

  if (isReset) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
        <Zap size={14} className="text-emerald-400 shrink-0" />
        <span className="text-xs text-emerald-400 font-medium">
          Fresh session active! You've doubled your Claude usage today.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 animate-pulse">
      <AlertTriangle size={14} className="text-amber-400 shrink-0" />
      <span className="text-xs text-amber-400 font-medium">
        {isWarning ? 'Session resets' : 'Day ending'} in {formatCountdown(sessionInfo.timeUntilNext)}
        {' '}— wrap up or carry tasks forward!
      </span>
    </div>
  );
};
