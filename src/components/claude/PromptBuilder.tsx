import React, { useState } from 'react';
import { Wand2, RefreshCw, BookOpen, Copy, Check, FileText, Save, CheckCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Input';
import { PromptTemplates } from './PromptTemplates';
import { Modal } from '../ui/Modal';
import type { PromptTemplate } from '../../types/task';
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
  onReset: () => void;
  // Full assembled meta-prompt sent to the CLI — shown as read-only preview
  builtPrompt?: string;
  onMarkDone?: () => Promise<void>;
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
  onReset,
  builtPrompt,
  onMarkDone,
}) => {
  const [showTemplates, setShowTemplates] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewCopied, setPreviewCopied] = useState(false);
  const [marked, setMarked] = useState(false);

  const handleTemplateSelect = (template: PromptTemplate) => {
    let filled = template.template;
    try {
      const vars: string[] = JSON.parse(template.variables);
      vars.forEach((v) => {
        filled = filled.replace(new RegExp(`\\{\\{${v}\\}\\}`, 'g'), `[${v}]`);
      });
    } catch {
      // use template as-is
    }
    onPromptChange(filled);
    setShowTemplates(false);
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

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Prompt Builder</h3>
        <Button
          variant="ghost"
          size="sm"
          icon={<BookOpen size={13} />}
          onClick={() => setShowTemplates(true)}
        >
          Templates
        </Button>
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

      {/* Rough prompt input */}
      <Textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={taskContext
          ? 'Describe what you want to do... Claude CLI will improve this into a detailed agent prompt.'
          : 'Write your rough prompt idea... Claude CLI will polish it into a detailed, actionable agent prompt.'}
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

      <div className="flex gap-2">
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
          <div className="flex gap-2">
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
          </div>
        </div>
      )}

      <Modal
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        title="Prompt Templates"
        size="lg"
      >
        <PromptTemplates onSelect={handleTemplateSelect} />
      </Modal>
    </div>
  );
};
