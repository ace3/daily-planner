import React, { useRef, useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, Loader2, ChevronDown, ChevronRight, X, Trash2, GitBranch, FlaskConical, GitMerge, AlertTriangle } from 'lucide-react';
import { usePromptQueueStore, PromptJob, QueueStep, PromptWorktreeStatus } from '../stores/promptQueueStore';
import { Button } from './ui/Button';

// ---------------------------------------------------------------------------
// Step badge
// ---------------------------------------------------------------------------

const StepBadge: React.FC<{ step: QueueStep }> = ({ step }) => {
  const cfg: Record<QueueStep, { icon: React.ReactNode; cls: string; text: string }> = {
    waiting: {
      icon: <Clock size={10} />,
      cls: 'border-gray-500/30 bg-gray-500/10 text-gray-400',
      text: '⏳ Waiting',
    },
    running: {
      icon: <Loader2 size={10} className="animate-spin" />,
      cls: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
      text: '🔄 Running…',
    },
    done: {
      icon: <CheckCircle size={10} />,
      cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
      text: '✅ Done',
    },
    error: {
      icon: <XCircle size={10} />,
      cls: 'border-red-500/30 bg-red-500/10 text-red-400',
      text: '❌ Error',
    },
  };
  const { cls, text } = cfg[step];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {text}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

const StatusPill: React.FC<{ status: PromptJob['status'] }> = ({ status }) => {
  const cfg: Record<PromptJob['status'], { label: string; cls: string }> = {
    pending: { label: 'Queued', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
    running: { label: 'In Progress', cls: 'border-blue-500/30 bg-blue-500/10 text-blue-400' },
    done: { label: 'Done', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' },
    error: { label: 'Error', cls: 'border-red-500/30 bg-red-500/10 text-red-400' },
  };
  const { label, cls } = cfg[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Log viewer
// ---------------------------------------------------------------------------

const LogViewer: React.FC<{ logs: string[] }> = ({ logs }) => {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs.length]);
  return (
    <pre
      ref={ref}
      className="mt-2 rounded-md border border-[#21262D] bg-[#0D1117] p-2.5 text-xs font-mono
                 text-[#8B949E] leading-relaxed overflow-y-auto max-h-40 whitespace-pre-wrap"
    >
      {logs.length > 0 ? logs.join('\n') : '(waiting for output…)'}
    </pre>
  );
};

// ---------------------------------------------------------------------------
// Worktree panel
// ---------------------------------------------------------------------------

const WorktreePanel: React.FC<{ job: PromptJob }> = ({ job }) => {
  const createWorktreeForJob = usePromptQueueStore((s) => s.createWorktreeForJob);
  const runTestsForJob = usePromptQueueStore((s) => s.runTestsForJob);
  const mergeWorktreeForJob = usePromptQueueStore((s) => s.mergeWorktreeForJob);
  const cleanupWorktreeForJob = usePromptQueueStore((s) => s.cleanupWorktreeForJob);
  const [showTestLog, setShowTestLog] = useState(false);

  const ws: PromptWorktreeStatus = job.worktreeStatus;

  // Only show worktree panel for jobs that have an original project path
  if (!job.originalProjectPath) return null;

  const statusColor: Record<PromptWorktreeStatus, string> = {
    none: 'text-[#484F58]',
    creating: 'text-amber-400',
    ready: 'text-blue-400',
    tests_running: 'text-blue-400',
    tests_passed: 'text-emerald-400',
    tests_failed: 'text-red-400',
    merging: 'text-amber-400',
    merged: 'text-emerald-400',
  };

  return (
    <div className="mt-2 rounded-lg border border-[#21262D] bg-[#0D1117] p-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <GitBranch size={11} className="text-[#8B949E]" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8B949E]">Worktree</span>
        {ws !== 'none' && (
          <span className={`text-[10px] font-medium ${statusColor[ws]}`}>
            {ws === 'creating' && '⏳ Creating…'}
            {ws === 'ready' && `🌿 ${job.worktreeBranch}`}
            {ws === 'tests_running' && '🔄 Running tests…'}
            {ws === 'tests_passed' && '✅ Tests passed'}
            {ws === 'tests_failed' && '❌ Tests failed'}
            {ws === 'merging' && '⏳ Merging…'}
            {ws === 'merged' && '✅ Merged'}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Create worktree button — for pending jobs not yet in worktree mode */}
        {ws === 'none' && job.status === 'pending' && (
          <Button
            variant="ghost"
            size="sm"
            icon={<GitBranch size={11} />}
            onClick={() => createWorktreeForJob(job.id)}
          >
            Run in Worktree
          </Button>
        )}

        {/* Run tests — available after job completes in a worktree */}
        {(ws === 'ready' || ws === 'tests_failed') && job.status === 'done' && (
          <Button
            variant="ghost"
            size="sm"
            icon={<FlaskConical size={11} />}
            onClick={() => runTestsForJob(job.id)}
          >
            {ws === 'tests_failed' ? 'Re-run Tests' : 'Run Tests'}
          </Button>
        )}

        {/* Merge button — only enabled when tests pass */}
        {ws === 'tests_passed' && (
          <Button
            variant="primary"
            size="sm"
            icon={<GitMerge size={11} />}
            onClick={() => mergeWorktreeForJob(job.id)}
          >
            Merge into main
          </Button>
        )}

        {/* Disabled merge — tests still running or failed */}
        {ws === 'tests_running' && (
          <Button variant="ghost" size="sm" icon={<Loader2 size={11} className="animate-spin" />} disabled>
            Running tests…
          </Button>
        )}
        {ws === 'tests_failed' && (
          <Button variant="ghost" size="sm" icon={<AlertTriangle size={11} className="text-red-400" />} disabled>
            Tests failed — fix before merging
          </Button>
        )}

        {/* Cleanup */}
        {(ws === 'ready' || ws === 'tests_passed' || ws === 'tests_failed') && job.status === 'done' && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={11} />}
            onClick={() => cleanupWorktreeForJob(job.id)}
          >
            Cleanup
          </Button>
        )}

        {/* Test log toggle */}
        {job.testOutput.length > 0 && (
          <button
            onClick={() => setShowTestLog((v) => !v)}
            className="text-[10px] text-[#484F58] hover:text-[#8B949E] cursor-pointer"
          >
            {showTestLog ? 'Hide test log' : 'Show test log'}
          </button>
        )}
      </div>

      {/* Test results summary */}
      {job.testResults && (
        <div className="flex gap-3 text-[10px]">
          <span className="text-[#8B949E]">
            Frontend: <span className="text-emerald-400">{job.testResults.frontend_passed} passed</span>
            {job.testResults.frontend_failed > 0 && (
              <span className="text-red-400"> / {job.testResults.frontend_failed} failed</span>
            )}
          </span>
          <span className="text-[#8B949E]">
            Rust: <span className="text-emerald-400">{job.testResults.rust_passed} passed</span>
            {job.testResults.rust_failed > 0 && (
              <span className="text-red-400"> / {job.testResults.rust_failed} failed</span>
            )}
          </span>
        </div>
      )}

      {/* Test log output */}
      {showTestLog && job.testOutput.length > 0 && (
        <LogViewer logs={job.testOutput} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

const QueueRow: React.FC<{ job: PromptJob; onCancel: (id: string) => void }> = ({ job, onCancel }) => {
  const [expanded, setExpanded] = useState(false);
  const hasLogs = job.status === 'running' || job.status === 'done' || job.status === 'error';
  const canCancel = job.status === 'pending' || job.status === 'running';
  const promptPreview = job.prompt.length > 80 ? job.prompt.slice(0, 80) + '…' : job.prompt;
  const hasWorktree = job.worktreeStatus !== 'none';

  useEffect(() => {
    if (job.status === 'running') setExpanded(true);
  }, [job.status]);

  return (
    <>
      <tr className="border-b border-[#21262D] hover:bg-[#161B22] transition-colors">
        {/* # */}
        <td className="px-3 py-2.5 text-center">
          <span className="px-1.5 py-0.5 rounded bg-[#21262D] text-[10px] font-mono text-[#8B949E]">
            #{job.queueNumber}
          </span>
        </td>
        {/* Prompt */}
        <td className="px-3 py-2.5 max-w-[200px]">
          <p className="text-xs text-[#E6EDF3] truncate" title={job.prompt}>{promptPreview}</p>
          {job.projectPath && !hasWorktree && (
            <p className="text-[10px] text-[#484F58] truncate">{job.projectPath}</p>
          )}
          {hasWorktree && job.worktreeBranch && (
            <p className="text-[10px] text-blue-400 truncate flex items-center gap-1">
              <GitBranch size={9} />{job.worktreeBranch}
            </p>
          )}
        </td>
        {/* Step 1: Improve */}
        <td className="px-3 py-2.5">
          <StepBadge step={job.improveStep} />
        </td>
        {/* Step 2: Run */}
        <td className="px-3 py-2.5">
          <StepBadge step={job.runStep} />
        </td>
        {/* Status */}
        <td className="px-3 py-2.5">
          <StatusPill status={job.status} />
        </td>
        {/* Actions */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {canCancel && (
              <button
                onClick={() => onCancel(job.id)}
                className="text-[#484F58] hover:text-red-400 cursor-pointer transition-colors"
                title="Cancel"
              >
                <X size={13} />
              </button>
            )}
            {hasLogs && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[#484F58] hover:text-[#8B949E] cursor-pointer"
                title={expanded ? 'Hide logs' : 'Show logs'}
              >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
          </div>
        </td>
      </tr>
      {/* Log expansion row */}
      {hasLogs && expanded && (
        <tr>
          <td colSpan={6} className="px-3 pb-2 bg-[#0D1117]">
            <LogViewer logs={job.logs} />
          </td>
        </tr>
      )}
      {/* Worktree panel — shown when job has a project path */}
      {job.originalProjectPath && (
        <tr>
          <td colSpan={6} className="px-3 pb-3 bg-[#0D1117]">
            <WorktreePanel job={job} />
          </td>
        </tr>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// PromptQueue
// ---------------------------------------------------------------------------

export const PromptQueue: React.FC = () => {
  const queue = usePromptQueueStore((s) => s.queue);
  const clearDone = usePromptQueueStore((s) => s.clearDone);
  const cancelJob = usePromptQueueStore((s) => s.cancelJob);

  const doneCount = queue.filter((j) => j.status === 'done' || j.status === 'error').length;

  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[#484F58]">
        <Clock size={28} className="mb-3 opacity-40" />
        <p className="text-sm">No jobs in the queue</p>
        <p className="text-xs mt-1">Run a prompt from the Builder tab to add jobs here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">
          Prompt Queue
          <span className="ml-2 text-xs font-normal text-[#8B949E]">
            {queue.length} job{queue.length !== 1 ? 's' : ''}
          </span>
        </h3>
        {doneCount > 0 && (
          <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={clearDone}>
            Clear done
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-[#30363D] overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#161B22] border-b border-[#30363D]">
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#8B949E] text-center w-10">#</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#8B949E]">Prompt</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#8B949E] whitespace-nowrap">Step 1: Improve</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#8B949E] whitespace-nowrap">Step 2: Run</th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#8B949E]">Status</th>
              <th className="px-3 py-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {queue.map((job) => (
              <QueueRow key={job.id} job={job} onCancel={cancelJob} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
