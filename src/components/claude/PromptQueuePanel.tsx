import React, { useRef, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Trash2, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { usePromptQueueStore, PromptJob } from '../../stores/promptQueueStore';
import { Button } from '../ui/Button';

// ---------------------------------------------------------------------------
// Log viewer — auto-scrolls to bottom as new lines arrive
// ---------------------------------------------------------------------------

const LogViewer: React.FC<{ logs: string[] }> = ({ logs }) => {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <pre
      ref={ref}
      className="mt-2 rounded-md border border-[#21262D] bg-[#0D1117] p-2.5 text-xs font-mono
                 text-[#8B949E] leading-relaxed overflow-y-auto max-h-48 whitespace-pre-wrap"
    >
      {logs.length > 0 ? logs.join('\n') : '(waiting for output…)'}
    </pre>
  );
};

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

const StatusPill: React.FC<{ status: PromptJob['status'] }> = ({ status }) => {
  const cfg: Record<PromptJob['status'], { label: string; cls: string; icon: React.ReactNode }> = {
    pending: {
      label: 'pending',
      cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
      icon: <Clock size={10} />,
    },
    running: {
      label: 'running',
      cls: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
      icon: <Loader2 size={10} className="animate-spin" />,
    },
    done: {
      label: 'done',
      cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
      icon: <CheckCircle size={10} />,
    },
    error: {
      label: 'error',
      cls: 'border-red-500/30 bg-red-500/10 text-red-400',
      icon: <XCircle size={10} />,
    },
  };
  const { label, cls, icon } = cfg[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {icon}
      {label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Single job card
// ---------------------------------------------------------------------------

const JobCard: React.FC<{ job: PromptJob }> = ({ job }) => {
  const [expanded, setExpanded] = useState(job.status === 'running');

  // Auto-expand when job starts running
  useEffect(() => {
    if (job.status === 'running') setExpanded(true);
  }, [job.status]);

  const hasLogs = job.status === 'running' || job.status === 'done' || job.status === 'error';
  const promptPreview = job.prompt.length > 120 ? job.prompt.slice(0, 120) + '…' : job.prompt;

  return (
    <div className="rounded-lg border border-[#21262D] bg-[#0F1117] p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-start gap-2">
        <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#21262D] text-[10px] font-mono text-[#8B949E]">
          #{job.queueNumber}
        </span>
        <p className="flex-1 text-xs text-[#E6EDF3] leading-relaxed break-words">{promptPreview}</p>
        <div className="shrink-0 flex items-center gap-1.5">
          <StatusPill status={job.status} />
          {hasLogs && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[#484F58] hover:text-[#8B949E] cursor-pointer"
              title={expanded ? 'Collapse logs' : 'Expand logs'}
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* Timestamp */}
      <div className="text-[10px] text-[#484F58]">
        Started {job.createdAt.toLocaleTimeString()}
        {job.finishedAt && ` · Finished ${job.finishedAt.toLocaleTimeString()}`}
      </div>

      {/* Log viewer */}
      {hasLogs && expanded && <LogViewer logs={job.logs} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export const PromptQueuePanel: React.FC = () => {
  const queue = usePromptQueueStore((s) => s.queue);
  const clearDone = usePromptQueueStore((s) => s.clearDone);

  if (queue.length === 0) return null;

  const doneCount = queue.filter((j) => j.status === 'done' || j.status === 'error').length;

  return (
    <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 space-y-3">
      {/* Panel header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">
          Run Queue
          <span className="ml-2 text-xs font-normal text-[#8B949E]">
            {queue.length} job{queue.length !== 1 ? 's' : ''}
          </span>
        </h3>
        {doneCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={12} />}
            onClick={clearDone}
          >
            Clear done
          </Button>
        )}
      </div>

      {/* Job list */}
      <div className="space-y-2">
        {queue.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
};
