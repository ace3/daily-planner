import React, { useState, useCallback, useEffect } from 'react';
import { GitBranch, RefreshCw, Loader2, Wand2, GitCommit, Upload } from 'lucide-react';
import { gitStatus, gitDiff, gitStageAll, gitCommit, gitPush, improvePromptWithClaude } from '../../lib/tauri';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toast';

interface GitFileStatus {
  status: string;
  path: string;
}

interface GitStatusResult {
  branch: string;
  files: GitFileStatus[];
}

interface Props {
  projectPath: string;
  projectId?: string;
}

const FILE_STATUS_COLOR: Record<string, string> = {
  M: 'text-amber-400',
  A: 'text-emerald-400',
  D: 'text-red-400',
  '??': 'text-blue-400',
};

function fileStatusColor(s: string): string {
  return FILE_STATUS_COLOR[s] ?? 'text-[#8B949E]';
}

export const GitPanel: React.FC<Props> = ({ projectPath, projectId }) => {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const aiProvider = useSettingsStore((s) => s.settings?.ai_provider ?? 'claude');

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError(null);
    try {
      const result = await gitStatus(projectPath);
      setStatus(result);
    } catch (e) {
      setStatusError(String(e));
    } finally {
      setLoadingStatus(false);
    }
  }, [projectPath]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await gitStageAll(projectPath);
      const diff = await gitDiff(projectPath);
      if (!diff.trim()) {
        toast.error('No changes to generate a commit message for.');
        return;
      }
      const prompt = `Generate a concise, conventional git commit message (single line) for the following diff. Output only the commit message, nothing else:\n\n${diff}`;
      const msg = await improvePromptWithClaude(prompt, projectPath, aiProvider, projectId);
      setCommitMsg(msg.trim());
      await refreshStatus();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      toast.error('Commit message is required.');
      return;
    }
    setCommitting(true);
    try {
      await gitCommit(projectPath, commitMsg);
      toast.success('Committed successfully.');
      setCommitMsg('');
      await refreshStatus();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    try {
      await gitPush(projectPath);
      toast.success('Pushed successfully.');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setPushing(false);
    }
  };

  const inputClass =
    'w-full bg-[#0F1117] border border-[#30363D] rounded-lg text-[#E6EDF3] text-xs placeholder-[#484F58] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors px-3 py-2 resize-none';

  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-[#0F1117] border-b border-gray-100 dark:border-[#21262D] space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <GitBranch size={12} className="text-[#8B949E]" />
          <span className="text-xs font-medium text-[#8B949E]">Git</span>
          {status && (
            <span className="text-xs text-[#484F58] font-mono">{status.branch}</span>
          )}
        </div>
        <button
          onClick={refreshStatus}
          disabled={loadingStatus}
          className="text-[#484F58] hover:text-[#8B949E] transition-colors cursor-pointer disabled:opacity-40"
          title="Refresh git status"
        >
          {loadingStatus ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
        </button>
      </div>

      {/* Error */}
      {statusError && (
        <p className="text-xs text-red-400 font-mono break-words">{statusError}</p>
      )}

      {/* File list */}
      {status && !statusError && (
        <div className="space-y-0.5 max-h-36 overflow-y-auto">
          {status.files.length === 0 ? (
            <p className="text-xs text-[#484F58]">No changes.</p>
          ) : (
            status.files.map((f) => (
              <div key={f.path} className="flex items-center gap-2 text-xs font-mono">
                <span className={`shrink-0 w-5 font-semibold ${fileStatusColor(f.status)}`}>
                  {f.status}
                </span>
                <span className="text-[#8B949E] truncate">{f.path}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Commit message */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#484F58]">Commit message</span>
          <Button
            variant="ghost"
            size="sm"
            icon={
              generating ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Wand2 size={11} />
              )
            }
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? 'Generating…' : 'Stage All & Generate'}
          </Button>
        </div>
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          rows={3}
          placeholder="Describe your changes…"
          className={inputClass}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={<GitCommit size={12} />}
          onClick={handleCommit}
          loading={committing}
          disabled={!commitMsg.trim() || committing}
        >
          Commit
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload size={12} />}
          onClick={handlePush}
          loading={pushing}
          disabled={pushing}
        >
          Push
        </Button>
      </div>
    </div>
  );
};
