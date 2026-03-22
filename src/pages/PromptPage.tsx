import React, { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { PromptBuilder } from '../components/claude/PromptBuilder';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getLocalDate } from '../lib/time';
import type { Task } from '../types/task';
import { Badge } from '../components/ui/Badge';

export const PromptPage: React.FC = () => {
  const { tasks, fetchTasks, savePromptResult, activeDate } = useTaskStore();
  const { settings } = useSettingsStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const today = getLocalDate(settings?.timezone_offset ?? 7);

  useEffect(() => {
    if (today !== activeDate) fetchTasks(today);
  }, [today]);

  const handleSaveResult = async (prompt: string, result: string) => {
    if (selectedTask) {
      await savePromptResult(selectedTask.id, prompt, result);
    }
  };

  const activeTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'carried_over');

  return (
    <div className="flex-1 overflow-hidden flex flex-col p-4 gap-4">
      <div className="flex items-center gap-2">
        <MessageSquare size={16} className="text-[#8B949E]" />
        <h1 className="text-base font-semibold text-[#E6EDF3]">Prompt Builder</h1>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* Task context panel */}
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-3 overflow-y-auto">
          <h3 className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide mb-2">
            Link to Task
          </h3>
          <div className="space-y-1.5">
            <button
              onClick={() => setSelectedTask(null)}
              className={`w-full text-left p-2 rounded-lg text-xs transition-colors cursor-pointer
                ${!selectedTask ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' : 'text-[#484F58] hover:text-[#8B949E] hover:bg-[#0F1117]'}`}
            >
              No link (standalone)
            </button>
            {activeTasks.map((task) => (
              <button
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className={`w-full text-left p-2.5 rounded-lg border transition-colors cursor-pointer
                  ${selectedTask?.id === task.id
                    ? 'border-blue-500/40 bg-blue-500/10'
                    : 'border-[#30363D] hover:border-[#444C56] hover:bg-[#1C2128]'
                  }`}
              >
                <div className="text-xs font-medium text-[#E6EDF3] truncate">{task.title}</div>
                <div className="flex gap-1 mt-0.5">
                  <Badge variant="gray">{task.task_type}</Badge>
                  {task.prompt_used && <Badge variant="blue">has prompt</Badge>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt builder */}
        <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 overflow-y-auto">
          <PromptBuilder
            initialPrompt={selectedTask?.notes || ''}
            onResponseSave={selectedTask ? handleSaveResult : undefined}
          />
        </div>
      </div>
    </div>
  );
};
