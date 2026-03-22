import React, { useState, useEffect } from 'react';
import { Play, Square, SkipForward } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import { startFocusSession, endFocusSession } from '../lib/tauri';
import { getLocalDate } from '../lib/time';
import type { Task } from '../types/task';
import { Badge } from '../components/ui/Badge';
import { SessionTimer } from '../components/session/SessionTimer';
import { toast } from '../components/ui/Toast';
import { useSessionTimer } from '../hooks/useSessionTimer';

export const FocusMode: React.FC = () => {
  const { tasks, fetchTasks, updateTaskStatus, activeDate } = useTaskStore();
  const { settings } = useSettingsStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const today = getLocalDate(settings?.timezone_offset ?? 7);

  useSessionTimer();

  useEffect(() => {
    if (today !== activeDate) fetchTasks(today);
  }, [today]);

  const activeTasks = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'skipped' && t.status !== 'carried_over'
  );

  const startFocus = async () => {
    if (!selectedTask) return;
    if (focusSessionId) return;
    const sessionId = await startFocusSession(selectedTask.id, today);
    setFocusSessionId(sessionId);
    toast.success('Focus session started');
  };

  const stopFocus = async () => {
    if (focusSessionId) {
      await endFocusSession(focusSessionId, '');
      setFocusSessionId(null);
      toast.success('Focus session saved');
    }
  };

  const markDone = async () => {
    if (!selectedTask) return;
    await stopFocus();
    await updateTaskStatus(selectedTask.id, 'done');
    toast.success('Task completed!');
    // Move to next
    const nextIdx = activeTasks.findIndex((t) => t.id === selectedTask.id) + 1;
    setSelectedTask(activeTasks[nextIdx] ?? null);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-base font-semibold text-[#E6EDF3]">Focus Mode</h1>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
          {/* Main focus area */}
          <div className="space-y-4">
            {/* Current task */}
            <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-5">
              {selectedTask ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Badge variant="blue">{selectedTask.task_type}</Badge>
                      <h2 className="text-lg font-semibold text-[#E6EDF3] mt-2">
                        {selectedTask.title}
                      </h2>
                      {selectedTask.notes && (
                        <p className="text-xs text-[#484F58] mt-1">{selectedTask.notes}</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#30363D] bg-[#0F1117] px-3 py-2 text-xs text-[#8B949E]">
                    Status: {focusSessionId ? 'Focus session in progress' : 'Ready to start focus session'}
                  </div>

                  {/* Controls */}
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="primary"
                      icon={<Play size={14} />}
                      onClick={startFocus}
                      disabled={!selectedTask || Boolean(focusSessionId)}
                    >
                      Start Focus
                    </Button>
                    <Button
                      variant="ghost"
                      icon={<Square size={14} />}
                      onClick={stopFocus}
                      disabled={!focusSessionId}
                    >
                      Stop
                    </Button>
                    <Button variant="success" icon={<SkipForward size={14} />} onClick={markDone}>
                      Done
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-[#484F58]">
                  <div className="text-sm mb-2">Select a task to focus on</div>
                  <div className="text-xs">Pick from the list on the right</div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Task picker + session timer */}
          <div className="space-y-3">
            <SessionTimer />

            <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-3">
              <h3 className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide mb-2">
                Tasks ({activeTasks.length})
              </h3>
              <div className="space-y-1.5">
                {activeTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-colors cursor-pointer
                      ${selectedTask?.id === task.id
                        ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                        : 'border-[#30363D] hover:border-[#444C56] text-[#8B949E] hover:text-[#E6EDF3]'
                      }`}
                  >
                    <div className="text-xs font-medium truncate">{task.title}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge variant={task.session_slot === 1 ? 'blue' : 'green'}>
                        S{task.session_slot}
                      </Badge>
                      <span className="text-xs text-[#484F58]">{task.task_type}</span>
                    </div>
                  </button>
                ))}
                {activeTasks.length === 0 && (
                  <p className="text-xs text-[#484F58] text-center py-3">
                    All tasks complete! Great work.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
