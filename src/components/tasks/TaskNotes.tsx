import React, { useState, useEffect } from 'react';
import { FileText, Save, FolderOpen } from 'lucide-react';
import { Textarea } from '../ui/Input';
import { Button } from '../ui/Button';
import type { Task } from '../../types/task';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionDraftState } from '../../hooks/useSessionDraftState';

interface TaskNotesProps {
  task: Task;
  onSave: (notes: string) => Promise<void>;
  onProjectChange?: (projectId: string | null) => Promise<void>;
}

export const TaskNotes: React.FC<TaskNotesProps> = ({ task, onSave, onProjectChange }) => {
  const [draft, setDraft] = useSessionDraftState(`task-notes:${task.id}`, {
    notes: '',
    dirty: false,
    initializedFromTask: false,
  });
  const [saving, setSaving] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);
  const { projects } = useProjectStore();
  const notes = draft.notes;
  const dirty = draft.dirty;

  useEffect(() => {
    if (draft.initializedFromTask) return;
    setDraft((prev) => ({
      ...prev,
      notes: task.notes || '',
      dirty: false,
      initializedFromTask: true,
    }));
  }, [task.id, task.notes, draft.initializedFromTask, setDraft]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft((prev) => ({ ...prev, notes: e.target.value, dirty: true }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(notes);
      setDraft((prev) => ({ ...prev, dirty: false }));
    } finally {
      setSaving(false);
    }
  };

  const handleProjectChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!onProjectChange) return;
    setProjectSaving(true);
    try {
      await onProjectChange(e.target.value || null);
    } finally {
      setProjectSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {onProjectChange && (
        <div className="flex items-center gap-2">
          <FolderOpen size={12} className="text-gray-500 dark:text-[#8B949E] shrink-0" />
          <select
            value={task.project_id ?? ''}
            onChange={handleProjectChange}
            disabled={projectSaving}
            className="flex-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500 outline-none focus:border-blue-500 transition-colors px-2 py-1 cursor-pointer disabled:opacity-50 dark:bg-[#0F1117] dark:border-[#30363D] dark:text-[#8B949E]"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-[#8B949E]">
        <FileText size={12} />
        <span>Notes / Prompt context</span>
      </div>
      <Textarea
        value={notes}
        onChange={handleChange}
        placeholder="Add notes, prompt drafts, research links..."
        rows={3}
      />
      {dirty && (
        <Button
          onClick={handleSave}
          variant="secondary"
          size="sm"
          loading={saving}
          icon={<Save size={12} />}
        >
          Save
        </Button>
      )}
    </div>
  );
};
