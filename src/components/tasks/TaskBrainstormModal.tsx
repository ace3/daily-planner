import React, { useMemo, useState } from 'react';
import { Sparkles, ClipboardPaste, Plus, Image as ImageIcon, CheckSquare, Square, Wand2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { toast } from '../ui/Toast';
import { brainstormTasksFromNotes } from '../../lib/tauri';
import type { BrainstormTaskSuggestion, TaskAttachmentInput, TaskPriority } from '../../types/task';
import type { Project } from '../../types/project';

interface TaskBrainstormModalProps {
  open: boolean;
  onClose: () => void;
  provider?: string;
  projects: Project[];
  onCreateTasks: (selected: BrainstormTaskSuggestion[], projectId: string | null, attachmentSummary: string) => Promise<void>;
}

interface LocalAttachment extends TaskAttachmentInput {
  id: string;
  previewUrl?: string;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function nextId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function normalizePriority(priority: number): TaskPriority {
  if (priority <= 1) return 1;
  if (priority >= 3) return 3;
  return 2;
}

export const TaskBrainstormModal: React.FC<TaskBrainstormModalProps> = ({
  open,
  onClose,
  provider,
  projects,
  onCreateTasks,
}) => {
  const [notes, setNotes] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<BrainstormTaskSuggestion[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected],
  );

  const reset = () => {
    setNotes('');
    setPathInput('');
    setAttachments([]);
    setProjectId('');
    setGenerating(false);
    setCreating(false);
    setError(null);
    setSuggestions([]);
    setSelected({});
  };

  const close = () => {
    reset();
    onClose();
  };

  const toggle = (idx: number) => {
    setSelected((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const addPathAttachment = () => {
    const path = pathInput.trim();
    if (!path) return;
    setAttachments((prev) => [
      ...prev,
      { id: nextId(), source: 'path', path },
    ]);
    setPathInput('');
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((x) => x.id !== id));
  };

  const handlePasteImage = async () => {
    if (!navigator.clipboard?.read) {
      toast.warning('Clipboard image API is not available in this environment. Use file path instead.');
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => ALLOWED_MIMES.has(t));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        if (blob.size > MAX_IMAGE_SIZE) {
          toast.error('Clipboard image exceeds 10MB limit.');
          return;
        }

        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Failed reading clipboard image.'));
          reader.readAsDataURL(blob);
        });

        if (!dataUrl.startsWith('data:')) {
          toast.error('Unsupported clipboard image payload.');
          return;
        }

        const b64 = dataUrl.split(',', 2)[1] || '';
        setAttachments((prev) => [
          ...prev,
          {
            id: nextId(),
            source: 'clipboard',
            mime: imageType,
            size: blob.size,
            data_base64: b64,
            previewUrl: URL.createObjectURL(blob),
          },
        ]);
        return;
      }

      toast.warning('No image found in clipboard.');
    } catch (e) {
      toast.error(`Failed to read clipboard image: ${String(e)}`);
    }
  };

  const handleGenerate = async () => {
    const trimmed = notes.trim();
    if (!trimmed) {
      setError('Notes are required.');
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const raw = await brainstormTasksFromNotes(trimmed, attachments, provider);
      const normalized = raw.map((x) => ({
        ...x,
        title: x.title.trim(),
        description: x.description?.trim() || 'No description provided.',
        checklist: (x.checklist || []).map((c) => c.trim()).filter(Boolean),
        priority: normalizePriority(Number(x.priority ?? 2)),
      }));

      if (normalized.length === 0) {
        setError('AI did not return valid tasks. Update notes and try again.');
        return;
      }

      setSuggestions(normalized);
      const defaultSelected: Record<number, boolean> = {};
      normalized.forEach((_, idx) => {
        defaultSelected[idx] = true;
      });
      setSelected(defaultSelected);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    const picked = suggestions.filter((_, idx) => selected[idx]);
    if (picked.length === 0) {
      setError('Select at least one task to create.');
      return;
    }

    const attachmentSummary = attachments
      .map((a) => (a.source === 'path'
        ? `- path: ${a.path}`
        : `- clipboard image: ${a.mime} (${a.size ?? 0} bytes)`))
      .join('\n');

    setCreating(true);
    setError(null);
    try {
      await onCreateTasks(picked, projectId || null, attachmentSummary);
      toast.success(`Created ${picked.length} task(s).`);
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Generate Tasks From Notes" size="lg">
      <div className="space-y-4">
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-300">
          Provide notes and optional image context. AI will generate tasks and checklist previews before creation.
        </div>

        <Textarea
          label="Notes"
          rows={6}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Describe what you want to build, constraints, release notes, and implementation hints..."
        />

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-[#8B949E]">
            Assign generated tasks to project
          </label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-lg text-gray-900 text-sm outline-none px-3 py-2 dark:bg-[#161B22] dark:border-[#30363D] dark:text-[#E6EDF3]"
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-[#8B949E]">
            Image Context
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<ClipboardPaste size={13} />}
              onClick={handlePasteImage}
            >
              Paste Image
            </Button>
            <div className="flex-1 min-w-[260px] flex gap-2">
              <Input
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder="/absolute/path/to/image.png"
              />
              <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={addPathAttachment}>
                Add Path
              </Button>
            </div>
          </div>

          {attachments.length > 0 && (
            <div className="grid gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-[#30363D] dark:bg-[#0F1117]"
                >
                  <div className="flex items-center gap-2 text-gray-700 dark:text-[#8B949E]">
                    <ImageIcon size={12} />
                    {attachment.source === 'path'
                      ? <span>{attachment.path}</span>
                      : <span>clipboard image ({attachment.mime}, {attachment.size} bytes)</span>}
                  </div>
                  <button
                    className="text-red-400 hover:text-red-300 cursor-pointer"
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="primary"
            size="sm"
            loading={generating}
            icon={<Wand2 size={13} />}
            onClick={handleGenerate}
          >
            Generate Preview
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-[#E6EDF3]">
                <Sparkles size={14} className="text-blue-400" />
                AI Task Preview
              </div>
              <span className="text-xs text-gray-500 dark:text-[#8B949E]">{selectedCount}/{suggestions.length} selected</span>
            </div>

            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {suggestions.map((task, idx) => (
                <div
                  key={`${task.title}-${idx}`}
                  className="rounded-lg border border-gray-200 bg-white p-3 dark:border-[#30363D] dark:bg-[#0F1117]"
                >
                  <button className="w-full text-left" onClick={() => toggle(idx)}>
                    <div className="flex items-start gap-2">
                      {selected[idx] ? (
                        <CheckSquare size={16} className="mt-0.5 text-blue-400" />
                      ) : (
                        <Square size={16} className="mt-0.5 text-gray-500" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-[#E6EDF3]">{task.title}</div>
                        <div className="text-xs text-gray-600 dark:text-[#8B949E] mt-0.5">{task.description}</div>
                        {task.checklist.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-gray-500 dark:text-[#8B949E]">
                            {task.checklist.map((item, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <span>-</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-2 text-[11px] uppercase tracking-wide text-gray-400 dark:text-[#6E7681]">
                          priority {task.priority}
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={13} />}
                loading={creating}
                onClick={handleCreate}
              >
                Create Selected Tasks
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
