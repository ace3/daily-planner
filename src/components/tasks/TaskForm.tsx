import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useMobileStore } from '../../stores/mobileStore';
import type { CreateTaskInput } from '../../types/task';
import { useProjectStore } from '../../stores/projectStore';

interface TaskFormProps {
  onSubmit: (input: CreateTaskInput) => Promise<void>;
  compact?: boolean;
}

export const TaskForm: React.FC<TaskFormProps> = ({ onSubmit, compact = true }) => {
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { projects } = useProjectStore();
  const { mobileMode: m } = useMobileStore();

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        project_id: projectId || undefined,
      });
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

  const projectSelect = projects.length > 0 ? (
    <select
      value={projectId}
      onChange={(e) => setProjectId(e.target.value)}
      className={`bg-gray-50 border border-gray-200 rounded-lg text-gray-500 outline-none focus:border-blue-500 transition-colors cursor-pointer dark:bg-[#161B22] dark:border-[#30363D] dark:text-[#8B949E]
        ${m ? 'text-base px-3 py-2.5 min-h-[44px]' : 'text-xs px-2 py-1.5'}`}
    >
      <option value="">No project</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  ) : null;

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className={`flex flex-col ${m ? 'gap-3' : 'gap-1.5'}`}>
        <div className={`flex ${m ? 'gap-3' : 'gap-2'}`}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add task... (Enter to add)"
            className={`flex-1 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors dark:bg-[#161B22] dark:border-[#30363D] dark:text-[#E6EDF3] dark:placeholder-[#484F58]
              ${m ? 'text-base px-4 py-3 min-h-[48px]' : 'text-sm px-3 py-1.5'}`}
          />
          <Button type="submit" variant="primary" size="sm" loading={submitting} icon={<Plus size={m ? 18 : 14} />}>
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
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What needs to be done?"
        autoFocus
      />
      {projects.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className={`text-gray-500 dark:text-[#8B949E] ${m ? 'text-sm' : 'text-xs'}`}>Project (optional)</label>
          {projectSelect}
        </div>
      )}
      <Button type="submit" variant="primary" loading={submitting} icon={<Plus size={m ? 18 : 14} />}>
        Add Task
      </Button>
    </form>
  );
};
