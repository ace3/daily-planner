import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { CreateTaskInput } from '../../types/task';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionDraftState } from '../../hooks/useSessionDraftState';

interface TaskFormProps {
  date: string;
  sessionSlot: number;
  onSubmit: (input: CreateTaskInput) => Promise<void>;
  compact?: boolean;
}

export const TaskForm: React.FC<TaskFormProps> = ({ date, sessionSlot, onSubmit, compact = true }) => {
  const draftKey = `task-form:${date}:${sessionSlot}:${compact ? 'compact' : 'full'}`;
  const [draft, setDraft, clearDraft] = useSessionDraftState(draftKey, { title: '', projectId: '' });
  const [submitting, setSubmitting] = useState(false);
  const { projects } = useProjectStore();

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!draft.title.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        date,
        session_slot: sessionSlot,
        title: draft.title.trim(),
        project_id: draft.projectId || undefined,
      });
      clearDraft();
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const projectSelect = projects.length > 0 ? (
    <select
      value={draft.projectId}
      onChange={(e) => setDraft((prev) => ({ ...prev, projectId: e.target.value }))}
      className="bg-gray-50 border border-gray-200 rounded-lg text-gray-500 text-xs outline-none focus:border-blue-500 transition-colors px-2 py-1.5 cursor-pointer dark:bg-[#161B22] dark:border-[#30363D] dark:text-[#8B949E]"
    >
      <option value="">No project</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  ) : null;

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <input
            value={draft.title}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
            onKeyDown={handleKeyDown}
            placeholder="Add task... (Enter to add)"
            className="flex-1 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors px-3 py-1.5 dark:bg-[#161B22] dark:border-[#30363D] dark:text-[#E6EDF3] dark:placeholder-[#484F58]"
          />
          <Button type="submit" variant="primary" size="sm" loading={submitting} icon={<Plus size={14} />}>
            Add
          </Button>
        </div>
        {projectSelect}
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        label="Task"
        value={draft.title}
        onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
        onKeyDown={handleKeyDown}
        placeholder="What needs to be done?"
        autoFocus
      />
      {projects.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-[#8B949E]">Project (optional)</label>
          {projectSelect}
        </div>
      )}
      <Button type="submit" variant="primary" loading={submitting} icon={<Plus size={14} />}>
        Add Task
      </Button>
    </form>
  );
};
