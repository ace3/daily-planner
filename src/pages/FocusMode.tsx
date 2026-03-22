import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, SkipForward } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import { startFocusSession, endFocusSession } from '../lib/tauri';
import { getLocalDate, formatCountdown } from '../lib/time';
import type { Task } from '../types/task';
import { Badge } from '../components/ui/Badge';
import { SessionTimer } from '../components/session/SessionTimer';
import { toast } from '../components/ui/Toast';
import { useSessionTimer } from '../hooks/useSessionTimer';

type PomodoroState = 'idle' | 'work' | 'break';

export const FocusMode: React.FC = () => {
  const { tasks, fetchTasks, updateTaskStatus, activeDate } = useTaskStore();
  const { settings } = useSettingsStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const [pomState, setPomState] = useState<PomodoroState>('idle');
  const [pomSeconds, setPomSeconds] = useState(0);
  const [pomCycles, setPomCycles] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const today = getLocalDate(settings?.timezone_offset ?? 7);

  useSessionTimer();

  useEffect(() => {
    if (today !== activeDate) fetchTasks(today);
  }, [today]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const workSecs = (settings?.pomodoro_work_min ?? 25) * 60;
  const breakSecs = (settings?.pomodoro_break_min ?? 5) * 60;

  const activeTasks = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'skipped' && t.status !== 'carried_over'
  );

  const startPomodoro = async () => {
    if (!selectedTask) return;
    if (pomState === 'idle') {
      // Start focus session in DB
      const sessionId = await startFocusSession(selectedTask.id, today);
      setFocusSessionId(sessionId);
    }
    setPomSeconds(pomState === 'break' ? breakSecs : workSecs);
    setPomState('work');
    intervalRef.current = window.setInterval(() => {
      setPomSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          // Auto-switch phase
          setPomState((cur) => {
            if (cur === 'work') {
              setPomCycles((c) => c + 1);
              setPomSeconds(breakSecs);
              startBreakTimer();
              return 'break';
            }
            setPomSeconds(workSecs);
            startWorkTimer();
            return 'work';
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startWorkTimer = () => {
    setPomSeconds(workSecs);
    intervalRef.current = window.setInterval(() => {
      setPomSeconds((p) => (p <= 1 ? 0 : p - 1));
    }, 1000);
  };

  const startBreakTimer = () => {
    setPomSeconds(breakSecs);
    intervalRef.current = window.setInterval(() => {
      setPomSeconds((p) => (p <= 1 ? 0 : p - 1));
    }, 1000);
  };

  const pausePomodoro = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setPomState('idle');
  };

  const stopPomodoro = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (focusSessionId) {
      await endFocusSession(focusSessionId, '');
      setFocusSessionId(null);
      toast.success('Focus session saved');
    }
    setPomState('idle');
    setPomSeconds(0);
  };

  const markDone = async () => {
    if (!selectedTask) return;
    await stopPomodoro();
    await updateTaskStatus(selectedTask.id, 'done');
    toast.success('Task completed!');
    // Move to next
    const nextIdx = activeTasks.findIndex((t) => t.id === selectedTask.id) + 1;
    setSelectedTask(activeTasks[nextIdx] ?? null);
  };

  const pomProgress = pomState !== 'idle'
    ? ((pomState === 'work' ? workSecs : breakSecs) - pomSeconds) / (pomState === 'work' ? workSecs : breakSecs) * 100
    : 0;

  const pomColor = pomState === 'break' ? '#10B981' : '#3B82F6';

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

                  {/* Pomodoro timer */}
                  <div className="text-center py-4">
                    <div className="relative inline-block">
                      <svg className="w-32 h-32 -rotate-90">
                        <circle cx="64" cy="64" r="56" fill="none" stroke="#21262D" strokeWidth="6" />
                        <circle
                          cx="64" cy="64" r="56"
                          fill="none"
                          stroke={pomColor}
                          strokeWidth="6"
                          strokeDasharray={`${2 * Math.PI * 56}`}
                          strokeDashoffset={`${2 * Math.PI * 56 * (1 - pomProgress / 100)}`}
                          strokeLinecap="round"
                          className="transition-all duration-1000"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-mono text-2xl font-bold text-[#E6EDF3]">
                          {pomState === 'idle'
                            ? formatCountdown(workSecs)
                            : formatCountdown(pomSeconds)}
                        </span>
                        <span className="text-xs text-[#484F58]">
                          {pomState === 'idle' ? 'ready' : pomState === 'work' ? 'focus' : 'break'}
                        </span>
                      </div>
                    </div>
                    {pomCycles > 0 && (
                      <div className="flex justify-center gap-1 mt-2">
                        {Array.from({ length: pomCycles }).map((_, i) => (
                          <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Controls */}
                  <div className="flex items-center justify-center gap-2">
                    {pomState === 'idle' ? (
                      <Button variant="primary" icon={<Play size={14} />} onClick={startPomodoro}>
                        Start Focus
                      </Button>
                    ) : (
                      <>
                        <Button variant="secondary" icon={<Pause size={14} />} onClick={pausePomodoro}>
                          Pause
                        </Button>
                        <Button variant="ghost" icon={<Square size={14} />} onClick={stopPomodoro}>
                          Stop
                        </Button>
                      </>
                    )}
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
