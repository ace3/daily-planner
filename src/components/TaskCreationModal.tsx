import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, GitBranch } from 'lucide-react';
import { useTaskStore } from '../stores/taskStore';
import { useProjectStore } from '../stores/projectStore';
import type { AgentProvider, CreateTaskInput, TaskPriority } from '../types/task';

export interface TaskCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultProjectId?: string;
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; dotClass: string }[] = [
  { value: 1, label: 'High',   dotClass: 'bg-red-500' },
  { value: 2, label: 'Medium', dotClass: 'bg-yellow-500' },
  { value: 3, label: 'Low',    dotClass: 'bg-gray-500' },
];

const AGENT_OPTIONS: { value: AgentProvider | ''; label: string; icon: string }[] = [
  { value: '',         label: 'None',      icon: '—' },
  { value: 'claude',   label: 'Claude',    icon: '✦' },
  { value: 'codex',    label: 'Codex',     icon: '⬡' },
  { value: 'opencode', label: 'OpenCode',  icon: '◈' },
  { value: 'copilot',  label: 'Copilot',   icon: '⊙' },
];

export const TaskCreationModal: React.FC<TaskCreationModalProps> = ({
  isOpen,
  onClose,
  defaultProjectId,
}) => {
  const { createTask } = useTaskStore();
  const { projects } = useProjectStore();

  // Form state
  const [title, setTitle]           = useState('');
  const [description, setDesc]      = useState('');
  const [priority, setPriority]     = useState<TaskPriority>(2);
  const [projectId, setProjectId]   = useState<string>(defaultProjectId ?? '');
  const [agent, setAgent]           = useState<AgentProvider | ''>('');
  const [deadline, setDeadline]     = useState('');
  const [gitWorkflow, setGitWorkflow] = useState(false);

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  // Sync defaultProjectId when modal opens
  useEffect(() => {
    if (isOpen) {
      setProjectId(defaultProjectId ?? '');
      // Focus title
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [isOpen, defaultProjectId]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setTitle('');
      setDesc('');
      setPriority(2);
      setProjectId(defaultProjectId ?? '');
      setAgent('');
      setDeadline('');
      setGitWorkflow(false);
      setError(null);
    }
  }, [isOpen]);

  // Close git workflow checkbox when project is deselected
  useEffect(() => {
    if (!projectId) setGitWorkflow(false);
  }, [projectId]);

  // Keyboard: Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSubmitting(true);
    setError(null);

    try {
      const input: CreateTaskInput = {
        title: trimmedTitle,
        ...(description.trim() && { description: description.trim() }),
        priority,
        task_type: 'other',
        ...(projectId && { project_id: projectId }),
        ...(agent && { agent }),
        ...(deadline && { deadline }),
        ...(projectId && { git_workflow: gitWorkflow }),
      };
      await createTask(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal card */}
      <div
        className="w-full dark:bg-[#161B22] bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.35)] flex flex-col overflow-hidden"
        style={{ maxWidth: 480 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-white/5">
          <h2 className="text-base font-semibold dark:text-[#E6EDF3]">New Task</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg dark:hover:bg-white/5 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-0 overflow-y-auto">
          {/* ── Section: Main Info ─────────────────────────────────── */}
          <div className="px-5 pt-4 pb-5 space-y-4">
            {/* Title */}
            <div>
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                required
                className="w-full rounded-lg px-3 h-10 dark:bg-[#0D1117] border dark:border-white/10 dark:text-[#E6EDF3] dark:placeholder-gray-600 focus:outline-none focus:border-blue-500/60 text-sm"
              />
            </div>

            {/* Description */}
            <div>
              <textarea
                value={description}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Add details..."
                rows={3}
                className="w-full rounded-lg px-3 py-2 dark:bg-[#0D1117] border dark:border-white/10 dark:text-[#E6EDF3] dark:placeholder-gray-600 focus:outline-none focus:border-blue-500/60 text-sm resize-none"
              />
            </div>

            {/* Priority toggle */}
            <div>
              <label className="block text-xs font-medium dark:text-gray-400 mb-2">Priority</label>
              <div className="flex gap-2">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium border transition-colors
                      ${priority === opt.value
                        ? 'dark:bg-white/10 dark:border-white/20 dark:text-[#E6EDF3]'
                        : 'dark:bg-transparent dark:border-white/5 dark:text-gray-500 dark:hover:border-white/10 dark:hover:text-gray-400'
                      }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dotClass}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px dark:bg-white/5" />

          {/* ── Section: Details ───────────────────────────────────── */}
          <div className="px-5 pt-4 pb-5 space-y-4">
            {/* Project */}
            <div>
              <label className="block text-xs font-medium dark:text-gray-400 mb-1.5">Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg px-3 h-10 dark:bg-[#0D1117] border dark:border-white/10 dark:text-[#E6EDF3] focus:outline-none focus:border-blue-500/60 text-sm appearance-none cursor-pointer"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Due date */}
            <div>
              <label className="block text-xs font-medium dark:text-gray-400 mb-1.5">Due date</label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-lg px-3 h-10 dark:bg-[#0D1117] border dark:border-white/10 dark:text-[#E6EDF3] focus:outline-none focus:border-blue-500/60 text-sm"
              />
            </div>
          </div>

          {/* Divider */}
          <div className="h-px dark:bg-white/5" />

          {/* ── Section: Execution ─────────────────────────────────── */}
          <div className="px-5 pt-4 pb-5 space-y-4">
            {/* AI Agent */}
            <div>
              <label className="block text-xs font-medium dark:text-gray-400 mb-1.5">AI Agent</label>
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value as AgentProvider | '')}
                className="w-full rounded-lg px-3 h-10 dark:bg-[#0D1117] border dark:border-white/10 dark:text-[#E6EDF3] focus:outline-none focus:border-blue-500/60 text-sm appearance-none cursor-pointer"
              >
                {AGENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.icon}  {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Git workflow — only when project selected */}
            {projectId && (
              <label className="flex items-center gap-3 cursor-pointer select-none group">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={gitWorkflow}
                    onChange={(e) => setGitWorkflow(e.target.checked)}
                    className="sr-only peer"
                  />
                  {/* Custom toggle */}
                  <div className="w-9 h-5 rounded-full border dark:border-white/10 dark:bg-[#0D1117] peer-checked:bg-blue-600 peer-checked:border-blue-600 transition-colors" />
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white/40 peer-checked:translate-x-4 peer-checked:bg-white transition-all" />
                </div>
                <div className="flex items-center gap-1.5 text-sm dark:text-gray-400 group-hover:dark:text-gray-300 transition-colors">
                  <GitBranch size={13} />
                  Create git branch and auto-commit
                </div>
              </label>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mx-5 mb-4 px-3 py-2 rounded-lg bg-red-900/30 border border-red-500/30 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Footer / Submit */}
          <div className="px-5 pb-5">
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="w-full h-10 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Creating…
                </>
              ) : (
                'Create Task'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
