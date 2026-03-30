import React, { useRef, useEffect } from 'react';
import { Clock, Loader2, CheckCircle, XCircle } from 'lucide-react';
import type { UnifiedStatus, JobKind } from '../../hooks/useUnifiedQueue';

// ---------------------------------------------------------------------------
// Status pill — generalized for all job types
// ---------------------------------------------------------------------------

const statusConfig: Record<UnifiedStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  pending: {
    label: 'Queued',
    cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    icon: <Clock size={10} />,
  },
  running: {
    label: 'Running',
    cls: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
    icon: <Loader2 size={10} className="animate-spin" />,
  },
  done: {
    label: 'Done',
    cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    icon: <CheckCircle size={10} />,
  },
  error: {
    label: 'Error',
    cls: 'border-red-500/30 bg-red-500/10 text-red-400',
    icon: <XCircle size={10} />,
  },
};

export const StatusPill: React.FC<{ status: UnifiedStatus }> = ({ status }) => {
  const { label, cls, icon } = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {icon}
      {label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Job kind badge
// ---------------------------------------------------------------------------

const kindConfig: Record<JobKind, { label: string; cls: string }> = {
  prompt: { label: 'Prompt', cls: 'border-blue-500/30 bg-blue-500/10 text-blue-400' },
  improve: { label: 'Improve', cls: 'border-purple-500/30 bg-purple-500/10 text-purple-400' },
  plan: { label: 'Plan', cls: 'border-teal-500/30 bg-teal-500/10 text-teal-400' },
};

export const JobKindBadge: React.FC<{ kind: JobKind }> = ({ kind }) => {
  const { label, cls } = kindConfig[kind];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Log viewer — auto-scrolls to bottom
// ---------------------------------------------------------------------------

export const LogViewer: React.FC<{ logs: string[]; maxHeight?: string }> = ({ logs, maxHeight = '300px' }) => {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs.length]);

  return (
    <pre
      ref={ref}
      className="rounded-md border border-[#21262D] bg-[#0D1117] p-2.5 text-xs font-mono
                 text-[#8B949E] leading-relaxed overflow-y-auto whitespace-pre-wrap"
      style={{ maxHeight }}
    >
      {logs.length > 0 ? logs.join('\n') : '(waiting for output...)'}
    </pre>
  );
};

// ---------------------------------------------------------------------------
// Streaming text — for improve partialResult / plan text
// ---------------------------------------------------------------------------

export const StreamingText: React.FC<{ text: string; isStreaming?: boolean }> = ({ text, isStreaming }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && isStreaming) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text, isStreaming]);

  return (
    <div
      ref={ref}
      className="rounded-md border border-[#21262D] bg-[#0D1117] p-3 text-xs text-[#C9D1D9] leading-relaxed overflow-y-auto whitespace-pre-wrap max-h-[400px]"
    >
      {text || '(waiting for output...)'}
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 bg-blue-400 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}
