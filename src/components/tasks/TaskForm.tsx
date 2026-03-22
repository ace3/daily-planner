import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { CreateTaskInput } from '../../types/task';

interface TaskFormProps {
  date: string;
  sessionSlot: number;
  onSubmit: (input: CreateTaskInput) => Promise<void>;
  compact?: boolean;
}

export const TaskForm: React.FC<TaskFormProps> = ({ date, sessionSlot, onSubmit, compact = true }) => {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ date, session_slot: sessionSlot, title: title.trim() });
      setTitle('');
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

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add task... (Enter to add)"
          className="flex-1 bg-[#161B22] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm placeholder-[#484F58] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors px-3 py-1.5"
        />
        <Button type="submit" variant="primary" size="sm" loading={submitting} icon={<Plus size={14} />}>
          Add
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        label="Task"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What needs to be done?"
        autoFocus
      />
      <Button type="submit" variant="primary" loading={submitting} icon={<Plus size={14} />}>
        Add Task
      </Button>
    </form>
  );
};
