import React, { useState, useEffect, useMemo } from 'react';
import {
  ListOrdered, Loader2, X, Trash2,
  GitBranch, FlaskConical, GitMerge, AlertTriangle, Filter,
} from 'lucide-react';
import { useUnifiedQueue, type UnifiedJob, type JobKind, type UnifiedStatus } from '../hooks/useUnifiedQueue';
import { usePromptQueueStore, type PromptJob, type QueueStep, type PromptWorktreeStatus } from '../stores/promptQueueStore';
import { useTaskStore } from '../stores/taskStore';
import { useMobileStore } from '../stores/mobileStore';
import { StatusPill, JobKindBadge, LogViewer, StreamingText, relativeTime } from '../components/queue/shared';
import { Button } from '../components/ui/Button';

// ---------------------------------------------------------------------------
// Step badge (from PromptQueue.tsx pattern)
// ---------------------------------------------------------------------------

const StepBadge: React.FC<{ label: string; step: QueueStep }> = ({ label, step }) => {
  const cfg: Record<QueueStep, { cls: string; text: string }> = {
    waiting: { cls: 'border-gray-500/30 bg-gray-500/10 text-gray-400', text: 'Waiting' },
    running: { cls: 'border-blue-500/30 bg-blue-500/10 text-blue-400', text: 'Running' },
    done: { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400', text: 'Done' },
    error: { cls: 'border-red-500/30 bg-red-500/10 text-red-400', text: 'Error' },
  };
  const { cls, text } = cfg[step];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {label}: {text}
      {step === 'running' && <Loader2 size={9} className="animate-spin" />}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Worktree panel (from PromptQueue.tsx)
// ---------------------------------------------------------------------------

const WorktreePanel: React.FC<{ job: PromptJob }> = ({ job }) => {
  const createWorktreeForJob = usePromptQueueStore((s) => s.createWorktreeForJob);
  const runTestsForJob = usePromptQueueStore((s) => s.runTestsForJob);
  const mergeWorktreeForJob = usePromptQueueStore((s) => s.mergeWorktreeForJob);
  const cleanupWorktreeForJob = usePromptQueueStore((s) => s.cleanupWorktreeForJob);
  const [showTestLog, setShowTestLog] = useState(false);

  const ws: PromptWorktreeStatus = job.worktreeStatus;
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
    <div className="rounded-lg border border-[#21262D] bg-[#0D1117] p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <GitBranch size={12} className="text-[#8B949E]" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8B949E]">Worktree</span>
        {ws !== 'none' && (
          <span className={`text-[11px] font-medium ${statusColor[ws]}`}>
            {ws === 'creating' && 'Creating...'}
            {ws === 'ready' && job.worktreeBranch}
            {ws === 'tests_running' && 'Running tests...'}
            {ws === 'tests_passed' && 'Tests passed'}
            {ws === 'tests_failed' && 'Tests failed'}
            {ws === 'merging' && 'Merging...'}
            {ws === 'merged' && 'Merged'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {ws === 'none' && job.status === 'pending' && (
          <Button variant="ghost" size="sm" icon={<GitBranch size={11} />} onClick={() => createWorktreeForJob(job.id)}>
            Run in Worktree
          </Button>
        )}
        {(ws === 'ready' || ws === 'tests_failed') && job.status === 'done' && (
          <Button variant="ghost" size="sm" icon={<FlaskConical size={11} />} onClick={() => runTestsForJob(job.id)}>
            {ws === 'tests_failed' ? 'Re-run Tests' : 'Run Tests'}
          </Button>
        )}
        {ws === 'tests_passed' && (
          <Button variant="primary" size="sm" icon={<GitMerge size={11} />} onClick={() => mergeWorktreeForJob(job.id)}>
            Merge into main
          </Button>
        )}
        {ws === 'tests_running' && (
          <Button variant="ghost" size="sm" icon={<Loader2 size={11} className="animate-spin" />} disabled>
            Running tests...
          </Button>
        )}
        {ws === 'tests_failed' && (
          <Button variant="ghost" size="sm" icon={<AlertTriangle size={11} className="text-red-400" />} disabled>
            Tests failed
          </Button>
        )}
        {(ws === 'ready' || ws === 'tests_passed' || ws === 'tests_failed') && job.status === 'done' && (
          <Button variant="ghost" size="sm" icon={<Trash2 size={11} />} onClick={() => cleanupWorktreeForJob(job.id)}>
            Cleanup
          </Button>
        )}
        {job.testOutput.length > 0 && (
          <button onClick={() => setShowTestLog((v) => !v)} className="text-[10px] text-[#484F58] hover:text-[#8B949E] cursor-pointer">
            {showTestLog ? 'Hide test log' : 'Show test log'}
          </button>
        )}
      </div>

      {job.testResults && (
        <div className="flex gap-3 text-[11px]">
          <span className="text-[#8B949E]">
            Frontend: <span className="text-emerald-400">{job.testResults.frontend_passed} passed</span>
            {job.testResults.frontend_failed > 0 && <span className="text-red-400"> / {job.testResults.frontend_failed} failed</span>}
          </span>
          <span className="text-[#8B949E]">
            Rust: <span className="text-emerald-400">{job.testResults.rust_passed} passed</span>
            {job.testResults.rust_failed > 0 && <span className="text-red-400"> / {job.testResults.rust_failed} failed</span>}
          </span>
        </div>
      )}

      {showTestLog && job.testOutput.length > 0 && <LogViewer logs={job.testOutput} maxHeight="200px" />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Prompt job detail
// ---------------------------------------------------------------------------

const PromptJobDetail: React.FC<{ job: PromptJob }> = ({ job }) => {
  const cancelJob = usePromptQueueStore((s) => s.cancelJob);
  const canCancel = job.status === 'pending' || job.status === 'running';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 rounded bg-[#21262D] text-[10px] font-mono text-[#8B949E]">
              #{job.queueNumber}
            </span>
            <StepBadge label="Improve" step={job.improveStep} />
            <StepBadge label="Run" step={job.runStep} />
          </div>
          {job.projectPath && (
            <p className="text-[11px] text-[#484F58] truncate flex items-center gap-1">
              <GitBranch size={10} />
              {job.projectPath}
            </p>
          )}
          {job.provider && (
            <p className="text-[11px] text-[#484F58]">Provider: {job.provider}</p>
          )}
        </div>
        {canCancel && (
          <Button variant="ghost" size="sm" icon={<X size={12} />} onClick={() => cancelJob(job.id)}>
            Cancel
          </Button>
        )}
      </div>

      {/* Full prompt */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#8B949E] mb-1.5">Prompt</h4>
        <div className="rounded-md border border-[#21262D] bg-[#0D1117] p-3 text-xs text-[#C9D1D9] leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto">
          {job.prompt}
        </div>
      </div>

      {/* Logs */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#8B949E] mb-1.5">Output</h4>
        <LogViewer logs={job.logs} />
      </div>

      {/* Pipeline error */}
      {job.pipelineError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertTriangle size={12} className="inline mr-1.5" />
          {job.pipelineError}
        </div>
      )}

      {/* Worktree */}
      <WorktreePanel job={job} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Improve job detail
// ---------------------------------------------------------------------------

const ImproveJobDetail: React.FC<{ run: NonNullable<UnifiedJob['improveRun']>; taskId?: string }> = ({ run, taskId }) => {
  const tasks = useTaskStore((s) => s.tasks);
  const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {task && <p className="text-xs text-[#8B949E]">Task: <span className="text-[#E6EDF3]">{task.title}</span></p>}
        {run.provider && <p className="text-[11px] text-[#484F58]">Provider: {run.provider}</p>}
        {run.error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400 mt-2">
            {run.error}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#8B949E] mb-1.5">Source Prompt</h4>
        <div className="rounded-md border border-[#21262D] bg-[#0D1117] p-3 text-xs text-[#C9D1D9] leading-relaxed whitespace-pre-wrap max-h-[150px] overflow-y-auto">
          {run.sourcePrompt}
        </div>
      </div>

      {(run.partialResult || run.improvedPrompt) && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#8B949E] mb-1.5">
            {run.status === 'running' ? 'Streaming Result' : 'Improved Prompt'}
          </h4>
          <StreamingText
            text={run.improvedPrompt ?? run.partialResult ?? ''}
            isStreaming={run.status === 'running'}
          />
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Plan job detail
// ---------------------------------------------------------------------------

const PlanJobDetail: React.FC<{ run: NonNullable<UnifiedJob['planRun']>; taskId?: string }> = ({ run, taskId }) => {
  const tasks = useTaskStore((s) => s.tasks);
  const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {task && <p className="text-xs text-[#8B949E]">Task: <span className="text-[#E6EDF3]">{task.title}</span></p>}
        {run.provider && <p className="text-[11px] text-[#484F58]">Provider: {run.provider}</p>}
        {run.error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400 mt-2">
            {run.error}
          </div>
        )}
      </div>

      {run.plan && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#8B949E] mb-1.5">Generated Plan</h4>
          <StreamingText
            text={run.plan}
            isStreaming={run.status === 'running'}
          />
        </div>
      )}

      {run.status === 'running' && !run.plan && (
        <div className="flex items-center gap-2 text-xs text-blue-400 py-4">
          <Loader2 size={14} className="animate-spin" />
          Generating plan...
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Job list item
// ---------------------------------------------------------------------------

const QueueJobListItem: React.FC<{
  job: UnifiedJob;
  isSelected: boolean;
  onClick: () => void;
}> = ({ job, isSelected, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full text-left px-3 py-2.5 border-b border-[#21262D] transition-colors cursor-pointer
      ${isSelected
        ? 'bg-[#1C2333] border-l-2 border-l-[#409CFF]'
        : 'hover:bg-[#161B22] border-l-2 border-l-transparent'
      }`}
  >
    <div className="flex items-center gap-2 mb-1">
      <JobKindBadge kind={job.kind} />
      <StatusPill status={job.status} />
      <span className="ml-auto text-[10px] text-[#484F58] shrink-0">{relativeTime(job.startedAt)}</span>
    </div>
    <p className="text-xs text-[#C9D1D9] truncate leading-relaxed">{job.label}</p>
  </button>
);

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------

type KindFilter = JobKind | 'all';
type StatusFilter = UnifiedStatus | 'all';

const FilterChip: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer
      ${active
        ? 'bg-[#409CFF]/15 text-[#409CFF] border border-[#409CFF]/30'
        : 'bg-[#21262D] text-[#8B949E] border border-transparent hover:border-[#30363D]'
      }`}
  >
    {label}
  </button>
);

// ---------------------------------------------------------------------------
// Queue Page
// ---------------------------------------------------------------------------

export const QueuePage: React.FC = () => {
  const { jobs, counts } = useUnifiedQueue();
  const clearDone = usePromptQueueStore((s) => s.clearDone);
  const { mobileMode } = useMobileStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Auto-select first running job on mount or when selection becomes stale
  useEffect(() => {
    if (selectedId && jobs.some((j) => j.id === selectedId)) return;
    const running = jobs.find((j) => j.status === 'running');
    if (running) setSelectedId(running.id);
    else if (jobs.length > 0) setSelectedId(jobs[0].id);
    else setSelectedId(null);
  }, [jobs.length]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (kindFilter !== 'all' && j.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && j.status !== statusFilter) return false;
      return true;
    });
  }, [jobs, kindFilter, statusFilter]);

  const selectedJob = selectedId ? jobs.find((j) => j.id === selectedId) : undefined;

  const doneCount = usePromptQueueStore((s) => s.queue.filter((j) => j.status === 'done' || j.status === 'error').length);

  // Empty state
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#484F58] py-20">
        <ListOrdered size={36} className="mb-4 opacity-30" />
        <p className="text-sm font-medium text-[#8B949E]">No jobs in the queue</p>
        <p className="text-xs mt-1.5">Run a prompt, improve, or generate a plan to see jobs here.</p>
      </div>
    );
  }

  const detailContent = selectedJob ? (
    <div className="p-4 overflow-y-auto h-full" data-scrollable>
      <div className="flex items-center gap-2 mb-4">
        <JobKindBadge kind={selectedJob.kind} />
        <StatusPill status={selectedJob.status} />
        <span className="text-[11px] text-[#484F58]">{relativeTime(selectedJob.startedAt)}</span>
        {selectedJob.finishedAt && (
          <span className="text-[11px] text-[#484F58]">
            - finished {relativeTime(selectedJob.finishedAt)}
          </span>
        )}
      </div>

      {selectedJob.kind === 'prompt' && selectedJob.promptJob && (
        <PromptJobDetail job={selectedJob.promptJob} />
      )}
      {selectedJob.kind === 'improve' && selectedJob.improveRun && (
        <ImproveJobDetail run={selectedJob.improveRun} taskId={selectedJob.taskId} />
      )}
      {selectedJob.kind === 'plan' && selectedJob.planRun && (
        <PlanJobDetail run={selectedJob.planRun} taskId={selectedJob.taskId} />
      )}
    </div>
  ) : (
    <div className="flex items-center justify-center h-full text-[#484F58] text-sm">
      Select a job to view details
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-[#21262D]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-[#E6EDF3]">Queue</h2>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[#8B949E]">{counts.total} total</span>
              {counts.running > 0 && (
                <span className="flex items-center gap-1 text-blue-400">
                  <Loader2 size={10} className="animate-spin" />
                  {counts.running} running
                </span>
              )}
              {counts.done > 0 && <span className="text-emerald-400">{counts.done} done</span>}
              {counts.error > 0 && <span className="text-red-400">{counts.error} error</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${showFilters ? 'bg-[#409CFF]/15 text-[#409CFF]' : 'text-[#484F58] hover:text-[#8B949E]'}`}
              title="Toggle filters"
            >
              <Filter size={14} />
            </button>
            {doneCount > 0 && (
              <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={clearDone}>
                Clear done
              </Button>
            )}
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="flex items-center gap-4 pt-1 pb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-[#484F58] uppercase tracking-wide mr-1">Kind:</span>
              <FilterChip label="All" active={kindFilter === 'all'} onClick={() => setKindFilter('all')} />
              <FilterChip label="Prompt" active={kindFilter === 'prompt'} onClick={() => setKindFilter('prompt')} />
              <FilterChip label="Improve" active={kindFilter === 'improve'} onClick={() => setKindFilter('improve')} />
              <FilterChip label="Plan" active={kindFilter === 'plan'} onClick={() => setKindFilter('plan')} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-[#484F58] uppercase tracking-wide mr-1">Status:</span>
              <FilterChip label="All" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
              <FilterChip label="Running" active={statusFilter === 'running'} onClick={() => setStatusFilter('running')} />
              <FilterChip label="Done" active={statusFilter === 'done'} onClick={() => setStatusFilter('done')} />
              <FilterChip label="Error" active={statusFilter === 'error'} onClick={() => setStatusFilter('error')} />
            </div>
          </div>
        )}
      </div>

      {/* List + Detail layout */}
      {mobileMode ? (
        /* Mobile: stacked layout */
        <div className="flex-1 min-h-0 overflow-y-auto" data-scrollable>
          <div className="divide-y divide-[#21262D]">
            {filteredJobs.map((job) => (
              <div key={job.id}>
                <QueueJobListItem
                  job={job}
                  isSelected={selectedId === job.id}
                  onClick={() => setSelectedId(selectedId === job.id ? null : job.id)}
                />
                {selectedId === job.id && (
                  <div className="border-b border-[#21262D] bg-[#0D1117]">
                    {detailContent}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Desktop: side-by-side */
        <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr]">
          {/* Job list */}
          <div className="border-r border-[#21262D] overflow-y-auto" data-scrollable>
            {filteredJobs.map((job) => (
              <QueueJobListItem
                key={job.id}
                job={job}
                isSelected={selectedId === job.id}
                onClick={() => setSelectedId(job.id)}
              />
            ))}
            {filteredJobs.length === 0 && (
              <div className="flex items-center justify-center py-10 text-xs text-[#484F58]">
                No jobs match filters
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div className="overflow-y-auto" data-scrollable>
            {detailContent}
          </div>
        </div>
      )}
    </div>
  );
};
