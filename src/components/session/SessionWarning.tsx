import React from 'react';
import { AlertTriangle, Zap } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { useMobileStore } from '../../stores/mobileStore';
import { formatCountdown } from '../../lib/time';

export const SessionWarning: React.FC = () => {
  const { sessionInfo } = useSessionStore();
  const { mobileMode: m } = useMobileStore();

  if (!sessionInfo) return null;

  const isWarning = sessionInfo.phase === 'session1_warning';
  const isReset = sessionInfo.phase === 'session2';
  const isEndWarning = sessionInfo.phase === 'session2_warning';

  if (!isWarning && !isReset && !isEndWarning) return null;

  const iconSize = m ? 18 : 14;
  const textClass = m ? 'text-sm' : 'text-xs';
  const padClass = m ? 'px-4 py-3 gap-3' : 'px-3 py-2 gap-2';

  if (isReset) {
    return (
      <div className={`flex items-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 ${padClass}`}>
        <Zap size={iconSize} className="text-emerald-400 shrink-0" />
        <span className={`${textClass} text-emerald-400 font-medium`}>
          Fresh session active! You've doubled your Claude usage today.
        </span>
      </div>
    );
  }

  return (
    <div className={`flex items-center rounded-lg bg-amber-500/10 border border-amber-500/30 animate-pulse ${padClass}`}>
      <AlertTriangle size={iconSize} className="text-amber-400 shrink-0" />
      <span className={`${textClass} text-amber-400 font-medium`}>
        {isWarning ? 'Session resets' : 'Day ending'} in {formatCountdown(sessionInfo.timeUntilNext)}
        {' '}— wrap up or carry tasks forward!
      </span>
    </div>
  );
};
