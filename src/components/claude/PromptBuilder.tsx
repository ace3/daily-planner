import React, { useEffect, useMemo, useState } from 'react';
import { Wand2, RefreshCw, Copy, Check, FileText, Save, CheckCircle, Play, Pencil, Plus, Trash2, GitBranch } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { ConfirmModal } from '../ui/ConfirmModal';
import { usePromptQueue } from '../../hooks/usePromptQueue';
import type { PromptTemplate } from '../../types/task';
import type { Project } from '../../types/project';
import { usePromptTemplateStore } from '../../stores/promptTemplateStore';
import { generateMasterPrompt, type MergeWarning, type PromptSourceInput } from '../../lib/masterPromptComposer';

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
  projectPath?: string;
  provider?: string;
  onRunAsWorktree?: () => Promise<void>;
  worktreeButtonDisabled?: boolean;
  worktreeButtonLabel?: string;
}

export type { TaskContext };

interface LocalPromptSource extends PromptSourceInput {
  contentError: string | null;
}

const createSourcePrompt = (index: number, content = '', selected = true): LocalPromptSource => ({
  id: `source-${Date.now()}-${index}`,
  label: `Prompt ${index + 1}`,
  content,
  selected,
  contentError: null,
});

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
  projectPath,
  provider,
  onRunAsWorktree,
  worktreeButtonDisabled,
  worktreeButtonLabel = 'Run as Worktree',
}) => {
  const {
    promptTemplates,
    selectedTemplateId,
    loading: templatesLoading,
    error: templatesError,
    fetchPromptTemplates,
    selectTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  } = usePromptTemplateStore();

  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateContent, setTemplateContent] = useState('');
  const [templateFormError, setTemplateFormError] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [queued, setQueued] = useState(false);
  const [previewCopied, setPreviewCopied] = useState(false);
  const [marked, setMarked] = useState(false);
  const [sources, setSources] = useState<LocalPromptSource[]>([createSourcePrompt(0, improved || prompt)]);
  const [mergeWarnings, setMergeWarnings] = useState<MergeWarning[]>([]);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeSuccess, setMergeSuccess] = useState<string | null>(null);
  const [mergeRunning, setMergeRunning] = useState(false);
  const { enqueue, pendingCount } = usePromptQueue();

  const resolvedProjectPath = projectPath ?? taskContext?.project?.path;

  useEffect(() => {
    fetchPromptTemplates().catch(() => null);
  }, [fetchPromptTemplates]);

  const selectedTemplate = useMemo(
    () => promptTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [promptTemplates, selectedTemplateId],
  );

  const resetTemplateForm = () => {
    setEditingTemplateId(null);
    setTemplateName('');
    setTemplateContent('');
    setTemplateFormError(null);
  };

  const handleTemplateSelect = (id: string) => {
    const template = promptTemplates.find((item) => item.id === id);
    selectTemplate(id || null);
    if (!template) return;
    // Apply mode: replace existing raw prompt text with template content.
    onPromptChange(template.content);
  };

  const startEditingTemplate = (template: PromptTemplate) => {
    setEditingTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateContent(template.content);
    setTemplateFormError(null);
    setShowTemplateManager(true);
  };

  const handleTemplateSave = async () => {
    const name = templateName.trim();
    const content = templateContent.trim();

    if (!name) {
      setTemplateFormError('Template name is required.');
      return;
    }
    if (!content) {
      setTemplateFormError('Template content is required.');
      return;
    }

    setTemplateSaving(true);
    setTemplateFormError(null);
    try {
      if (editingTemplateId) {
        await updateTemplate(editingTemplateId, name, content);
      } else {
        await createTemplate(name, content);
      }
      resetTemplateForm();
    } catch (e) {
      setTemplateFormError(String(e));
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTemplate(deleteTarget.id);
      if (editingTemplateId === deleteTarget.id) {
        resetTemplateForm();
      }
      setDeleteTarget(null);
    } catch (e) {
      setTemplateFormError(String(e));
      setDeleteTarget(null);
    }
  };

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

  const hasUsableSource = useMemo(
    () => sources.some((source) => source.selected && source.content.trim().length > 0),
    [sources],
  );

  const updateSource = (id: string, patch: Partial<LocalPromptSource>) => {
    setSources((prev) => prev.map((source) => (source.id === id ? { ...source, ...patch } : source)));
  };

  const handleAddSource = () => {
    setSources((prev) => [...prev, createSourcePrompt(prev.length)]);
  };

  const handleRemoveSource = (id: string) => {
    setSources((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((source) => source.id !== id);
    });
  };

  const handleImportImproved = () => {
    const imported = improved.trim();
    if (!imported) {
      setMergeError('Nothing to import: improve a prompt first or paste source prompts manually.');
      setMergeSuccess(null);
      return;
    }
    setMergeError(null);
    setMergeSuccess(null);
    setSources((prev) => {
      const nextIndex = prev.length;
      return [...prev, createSourcePrompt(nextIndex, imported, true)];
    });
  };

  const handleGenerateMasterPrompt = async () => {
    setMergeRunning(true);
    setMergeError(null);
    setMergeSuccess(null);
    setMergeWarnings([]);

    try {
      const result = generateMasterPrompt(sources);
      onImprovedChange(result.masterPrompt);
      setMergeWarnings(result.warnings);
      setMergeSuccess(`Master prompt generated from ${result.usedSourceIds.length} source prompt${result.usedSourceIds.length > 1 ? 's' : ''}.`);
      console.info('[prompt-merge] Generated master prompt', {
        usedSources: result.usedSourceIds.length,
        skippedSources: result.skippedSourceIds.length,
        warningCount: result.warnings.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMergeError(message);
      console.error('[prompt-merge] Failed to generate master prompt', { message });
    } finally {
      setMergeRunning(false);
    }
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

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2 dark:border-[#30363D] dark:bg-[#0F1117]">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-[#8B949E]">
            Use Template
          </label>
          <select
            value={selectedTemplateId ?? ''}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="min-w-[220px] bg-white border border-gray-200 rounded-lg text-gray-900 text-xs outline-none px-2.5 py-1.5
                       focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                       dark:bg-[#161B22] dark:border-[#30363D] dark:text-[#E6EDF3]"
          >
            <option value="">Choose a template...</option>
            {promptTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            icon={<Pencil size={12} />}
            onClick={() => setShowTemplateManager((prev) => !prev)}
          >
            {showTemplateManager ? 'Close manager' : 'Manage templates'}
          </Button>
        </div>
        <div className="text-xs text-gray-500 dark:text-[#8B949E]">
          Apply mode: <span className="font-medium">Replace raw prompt</span>
          {selectedTemplate ? ` (${selectedTemplate.name})` : ''}
        </div>
        {templatesLoading && <div className="text-xs text-gray-500 dark:text-[#8B949E]">Loading templates...</div>}
        {templatesError && (
          <div className="text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap">Failed to load templates: {templatesError}</div>
        )}
      </div>

      {showTemplateManager && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-3 dark:border-[#30363D] dark:bg-[#161B22]">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#8B949E]">
                Templates
              </h4>
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={12} />}
                onClick={resetTemplateForm}
              >
                New
              </Button>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {promptTemplates.length === 0 && (
                <div className="text-xs text-gray-500 dark:text-[#8B949E]">No templates yet.</div>
              )}
              {promptTemplates.map((template) => (
                <div
                  key={template.id}
                  className={`rounded-lg border p-2 ${editingTemplateId === template.id
                    ? 'border-blue-500/40 bg-blue-500/10'
                    : 'border-gray-200 bg-gray-50 dark:border-[#30363D] dark:bg-[#0F1117]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => startEditingTemplate(template)}
                      className="text-left flex-1 cursor-pointer"
                    >
                      <div className="text-xs font-medium text-gray-900 dark:text-[#E6EDF3]">{template.name}</div>
                      <div className="text-xs text-gray-500 dark:text-[#8B949E] line-clamp-2">{template.content}</div>
                    </button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={11} />}
                      onClick={() => setDeleteTarget(template)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#8B949E]">
              {editingTemplateId ? 'Edit template' : 'Create template'}
            </h4>
            <Input
              label="Name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name"
            />
            <Textarea
              label="Content"
              value={templateContent}
              onChange={(e) => setTemplateContent(e.target.value)}
              rows={7}
              placeholder="Template content"
            />
            {(templateFormError || templatesError) && (
              <div className="text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap">
                {templateFormError ?? templatesError}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<Save size={12} />}
                onClick={handleTemplateSave}
                loading={templateSaving}
              >
                {editingTemplateId ? 'Save changes' : 'Create template'}
              </Button>
              {editingTemplateId && (
                <Button variant="ghost" size="sm" onClick={resetTemplateForm}>
                  Cancel edit
                </Button>
              )}
            </div>
          </div>
        </div>
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

      <section className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#0F1117] p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-[#E6EDF3]">
              Master Prompt Composer
            </h4>
            <p className="text-xs text-gray-500 dark:text-[#8B949E] leading-relaxed">
              Select multiple improved prompts, merge intent, resolve conflicts, and produce one task-based execution prompt.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon={<Plus size={12} />} onClick={handleAddSource}>
              Add Source Prompt
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Copy size={12} />}
              onClick={handleImportImproved}
              disabled={!improved.trim()}
              title={!improved.trim() ? 'Generate an improved prompt first, then import it as a source' : undefined}
            >
              Import Improved
            </Button>
          </div>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {sources.map((source, index) => (
            <div
              key={source.id}
              className={`rounded-lg border p-2.5 transition-colors ${
                source.selected
                  ? 'border-gray-200 dark:border-[#30363D] bg-gray-50 dark:bg-[#161B22]'
                  : 'border-gray-200 dark:border-[#30363D] bg-white/60 dark:bg-[#161B22]/60 opacity-80'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <input
                  id={`source-selected-${source.id}`}
                  type="checkbox"
                  checked={source.selected}
                  onChange={(e) => updateSource(source.id, { selected: e.target.checked })}
                  className="h-4 w-4 accent-blue-500 cursor-pointer"
                />
                <label
                  htmlFor={`source-selected-${source.id}`}
                  className="text-xs font-medium text-gray-700 dark:text-[#E6EDF3] cursor-pointer"
                >
                  Include {source.label}
                </label>
                <span className="text-[10px] text-gray-500 dark:text-[#8B949E] ml-auto">
                  {source.content.trim().length} chars
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Trash2 size={11} />}
                  disabled={sources.length <= 1}
                  onClick={() => handleRemoveSource(source.id)}
                  title={sources.length <= 1 ? 'At least one source prompt is required' : undefined}
                >
                  Remove
                </Button>
              </div>
              <Input
                label="Source Name"
                value={source.label}
                onChange={(e) => updateSource(source.id, { label: e.target.value || `Prompt ${index + 1}` })}
                placeholder={`Prompt ${index + 1}`}
              />
              <Textarea
                label={`Source Prompt ${index + 1}`}
                value={source.content}
                onChange={(e) => updateSource(source.id, { content: e.target.value, contentError: null })}
                rows={4}
                placeholder="Paste one improved prompt here..."
                error={source.contentError ?? undefined}
              />
            </div>
          ))}
        </div>

        {!hasUsableSource && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            Add or import at least one non-empty selected source prompt to generate the master prompt.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={<Wand2 size={12} />}
            onClick={handleGenerateMasterPrompt}
            loading={mergeRunning}
            disabled={!hasUsableSource}
            className="min-w-[180px]"
          >
            {mergeRunning ? 'Generating...' : 'Generate Master Prompt'}
          </Button>
          {mergeSuccess && (
            <span className="text-xs text-green-700 dark:text-green-400" role="status">
              {mergeSuccess}
            </span>
          )}
        </div>

        {mergeError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300" role="alert">
            {mergeError}
          </div>
        )}

        {mergeWarnings.length > 0 && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2.5 space-y-1">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Merge Notes</p>
            <ul className="text-xs text-blue-700 dark:text-blue-200 list-disc list-inside space-y-1">
              {mergeWarnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`}>{warning.message}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

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

      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete Template"
        description={deleteTarget
          ? `Delete "${deleteTarget.name}"? This cannot be undone.`
          : 'Delete this template?'}
        confirmLabel="Delete template"
        variant="danger"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteTemplate}
      />
    </div>
  );
};
