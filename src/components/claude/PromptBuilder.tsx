import React, { useState } from 'react';
import { Wand2, RefreshCw, Copy, Check, FileText, Save, CheckCircle, Play, GitBranch } from 'lucide-react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Input';
import { usePromptQueue } from '../../hooks/usePromptQueue';
import type { Project } from '../../types/project';

interface TaskContext {
  title: string;
  notes: string;
  project?: Project;
}

interface PromptBuilderProps {
  taskContext?: TaskContext;
  onResponseSave?: (prompt: string, response: string) => Promise<void>;
  // Controlled state — owned by parent for per-task concurrency
  prompt: string;
  onPromptChange: (value: string) => void;
  improved: string;
  onImprovedChange: (value: string) => void;
  loading: boolean;
  error: string | null;
  onImprove: () => void;
  onCancelImprove?: () => void;
  onReset: () => void;
  // Full assembled meta-prompt sent to the CLI — shown as read-only preview
  builtPrompt?: string;
  onMarkDone?: () => Promise<void>;
  projectPath?: string;
  provider?: string;
  onRunAsWorktree?: () => Promise<void>;
  worktreeButtonDisabled?: boolean;
  worktreeButtonLabel?: string;
}

export type { TaskContext };

export const PromptBuilder: React.FC<PromptBuilderProps> = ({
  taskContext,
  onResponseSave,
  prompt,
  onPromptChange,
  improved,
  onImprovedChange,
  loading,
  error,
  onImprove,
  onCancelImprove,
  onReset,
  builtPrompt,
  onMarkDone,
  projectPath,
  provider,
  onRunAsWorktree,
  worktreeButtonDisabled,
  worktreeButtonLabel = 'Run as Worktree',
}) => {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [queued, setQueued] = useState(false);
  const [previewCopied, setPreviewCopied] = useState(false);
  const [marked, setMarked] = useState(false);
  const { enqueue, pendingCount } = usePromptQueue();

  const resolvedProjectPath = projectPath ?? taskContext?.project?.path;

  const handleRun = () => {
    if (!improved) return;
    enqueue({ prompt: improved, projectPath: resolvedProjectPath, provider });
    setQueued(true);
    setTimeout(() => setQueued(false), 2000);
  };

  const handleSave = async () => {
    if (!onResponseSave || !improved) return;
    await onResponseSave(prompt, improved);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCopy = async () => {
    if (!improved) return;
    await navigator.clipboard.writeText(improved);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePreviewCopy = async () => {
    if (!builtPrompt) return;
    await navigator.clipboard.writeText(builtPrompt);
    setPreviewCopied(true);
    setTimeout(() => setPreviewCopied(false), 2000);
  };

  const handleMarkDone = async () => {
    if (!onMarkDone) return;
    await onMarkDone();
    setMarked(true);
    setTimeout(() => setMarked(false), 2000);
  };

  const normalizedTaskTitle = taskContext?.title?.trim() ?? '';
  const canUseTaskTitle = normalizedTaskTitle.length > 0;

  const handleUseTaskTitle = () => {
    if (!canUseTaskTitle) return;
    onPromptChange(normalizedTaskTitle);
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Prompt Builder</h3>
      </div>

      {/* Task context info panel */}
      {taskContext && (
        <div className="rounded-lg border border-[#21262D] bg-[#0F1117] p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-[#8B949E]">
            <FileText size={11} />
            <span className="font-medium uppercase tracking-wide">Task Context</span>
          </div>
          <div className="text-xs font-medium text-[#E6EDF3]">{taskContext.title}</div>
          {taskContext.notes && (
            <div className="text-xs text-[#8B949E] whitespace-pre-wrap leading-relaxed">{taskContext.notes}</div>
          )}
          {taskContext.project && (
            <div className="text-xs text-blue-400 truncate">
              📁 {taskContext.project.name} — <span className="text-[#484F58]">{taskContext.project.path}</span>
            </div>
          )}
        </div>
      )}

      {/* Mark as Done */}
      {onMarkDone && (
        <Button
          variant="ghost"
          size="sm"
          icon={marked ? <Check size={13} className="text-green-400" /> : <CheckCircle size={13} />}
          onClick={handleMarkDone}
          className={`self-start ${marked ? 'text-green-400' : ''}`}
        >
          {marked ? 'Done!' : 'Mark as Done'}
        </Button>
      )}

      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">
          Prompt
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleUseTaskTitle}
          disabled={!canUseTaskTitle}
          title={canUseTaskTitle ? 'Overwrite prompt with the current task title' : 'Task title is empty'}
        >
          Use Task Title
        </Button>
      </div>

      {/* Rough prompt input */}
      <Textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={taskContext
          ? 'Describe what you want to do... the selected AI provider will improve this into a detailed agent prompt.'
          : 'Write your rough prompt idea... the selected AI provider will polish it into a detailed, actionable agent prompt.'}
        rows={5}
      />

      {/* Generated prompt preview */}
      {builtPrompt && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Generated Prompt</span>
            <Button
              variant="ghost"
              size="sm"
              icon={previewCopied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              onClick={handlePreviewCopy}
              className={previewCopied ? 'text-green-400' : ''}
            >
              {previewCopied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <pre className="rounded-lg border border-[#21262D] bg-[#0F1117] p-3 text-xs text-[#8B949E] font-mono whitespace-pre-wrap overflow-y-auto max-h-48 leading-relaxed">
            {builtPrompt}
          </pre>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button
          variant="primary"
          icon={<Wand2 size={13} />}
          onClick={onImprove}
          loading={loading}
          disabled={!prompt.trim()}
          className="flex-1"
        >
          {loading ? 'Improving...' : 'Improve Prompt'}
        </Button>
        {loading && onCancelImprove && (
          <Button
            variant="danger"
            size="md"
            onClick={onCancelImprove}
            className="shrink-0"
          >
            Cancel Improve
          </Button>
        )}
        {onRunAsWorktree && (
          <Button
            variant="ghost"
            icon={<GitBranch size={13} className="text-purple-400" />}
            onClick={onRunAsWorktree}
            disabled={worktreeButtonDisabled || !prompt.trim()}
            className="flex-1 text-purple-400 hover:text-purple-300 border border-purple-500/30 hover:border-purple-500/60"
            title="Create a git worktree, run the improved prompt in it, run tests, then merge if tests pass"
          >
            {worktreeButtonLabel}
          </Button>
        )}
        {(improved || error) && (
          <Button variant="ghost" size="md" icon={<RefreshCw size={13} />} onClick={onReset}>
            Reset
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* Improved prompt result — editable */}
      {improved && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-green-400 uppercase tracking-wide">Improved Prompt</span>
            <span className="text-xs text-[#484F58]">Editable — tweak before copying</span>
          </div>
          <Textarea
            value={improved}
            onChange={(e) => onImprovedChange(e.target.value)}
            rows={8}
            className="font-mono text-xs text-[#E6EDF3]"
          />
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              icon={copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
              onClick={handleCopy}
              className={`flex-1 ${copied ? 'text-green-400' : ''}`}
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            {onResponseSave && (
              <Button
                variant="ghost"
                size="sm"
                icon={saved ? <Check size={13} className="text-green-400" /> : <Save size={13} />}
                onClick={handleSave}
                className={`flex-1 ${saved ? 'text-green-400' : ''}`}
              >
                {saved ? 'Saved!' : 'Save to Task'}
              </Button>
            )}
            <div className="flex-1 flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                icon={queued ? <Check size={13} className="text-emerald-400" /> : <Play size={13} className="text-emerald-400" />}
                onClick={handleRun}
                className={`flex-1 ${queued ? 'text-emerald-400' : 'text-emerald-400 hover:text-emerald-300'}`}
              >
                {queued ? 'Queued!' : 'Run'}
              </Button>
              {pendingCount > 0 && (
                <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium
                                 border border-amber-500/30 bg-amber-500/10 text-amber-400 whitespace-nowrap">
                  Queue: {pendingCount} pending
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
