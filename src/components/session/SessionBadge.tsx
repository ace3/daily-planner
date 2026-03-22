import React from 'react';
import { Badge } from '../ui/Badge';
import { useSessionStore } from '../../stores/sessionStore';

interface SessionBadgeProps {
  slot: number;
}

export const SessionBadge: React.FC<SessionBadgeProps> = ({ slot }) => {
  const { sessionInfo } = useSessionStore();

  const isActive = sessionInfo && (
    (slot === 1 && ['kickstart', 'planning', 'coding', 'session1_warning'].includes(sessionInfo.phase)) ||
    (slot === 2 && ['session2', 'session2_active', 'session2_warning'].includes(sessionInfo.phase))
  );

  return (
    <Badge variant={isActive ? 'blue' : 'gray'}>
      Session {slot} {isActive ? '• Active' : ''}
    </Badge>
  );
};
