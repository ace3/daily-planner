import React, { useState, useEffect } from 'react';
import { FileText, Save } from 'lucide-react';
import { Textarea } from '../ui/Input';
import { Button } from '../ui/Button';
import type { Task } from '../../types/task';

interface TaskNotesProps {
  task: Task;
  onSave: (notes: string) => Promise<void>;
}

export const TaskNotes: React.FC<TaskNotesProps> = ({ task, onSave }) => {
  const [notes, setNotes] = useState(task.notes || '');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNotes(task.notes || '');
    setDirty(false);
  }, [task.id, task.notes]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(notes);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-[#8B949E]">
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
