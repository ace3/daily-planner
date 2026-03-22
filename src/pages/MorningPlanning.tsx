import React, { useEffect, useState } from 'react';
import { Zap, ArrowRight, Plus } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getLocalDate } from '../lib/time';
import { format, subDays } from 'date-fns';
import type { Task } from '../types/task';
import { getTasks as getTasksApi } from '../lib/tauri';
import { toast } from '../components/ui/Toast';

interface MorningPlanningProps {
  onClose: () => void;
  onGoToFocus: () => void;
}

export const MorningPlanning: React.FC<MorningPlanningProps> = ({ onClose, onGoToFocus }) => {
  const { createTask, fetchTasks, updateTaskStatus, carryTaskForward } = useTaskStore();
  const { settings } = useSettingsStore();
  const [bulkInput, setBulkInput] = useState('');
  const [addingBulk, setAddingBulk] = useState(false);
  const [yesterdayTasks, setYesterdayTasks] = useState<Task[]>([]);

  const today = getLocalDate(settings?.timezone_offset ?? 7);
  const yesterday = format(subDays(new Date(today + 'T00:00:00'), 1), 'yyyy-MM-dd');

  useEffect(() => {
    // Load yesterday's unfinished tasks
    getTasksApi(yesterday).then((ytasks) => {
      setYesterdayTasks(ytasks.filter((t) => t.status === 'pending' || t.status === 'in_progress'));
    });
  }, [yesterday]);

  const handleBulkAdd = async () => {
    const lines = bulkInput.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setAddingBulk(true);
    try {
      for (const title of lines) {
        await createTask({ date: today, session_slot: 1, title });
      }
      setBulkInput('');
      toast.success(`Added ${lines.length} task${lines.length > 1 ? 's' : ''}`);
    } finally {
      setAddingBulk(false);
    }
  };

  const handleCarryYesterday = async (task: Task) => {
    await carryTaskForward(task.id, today, 1);
    setYesterdayTasks((prev) => prev.filter((t) => t.id !== task.id));
    await fetchTasks(today);
    toast.success('Task carried from yesterday');
  };

  const handleSkipYesterday = async (task: Task) => {
    await updateTaskStatus(task.id, 'skipped');
    setYesterdayTasks((prev) => prev.filter((t) => t.id !== task.id));
    toast.info('Task skipped');
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#161B22] border-b border-[#30363D] px-6 py-4 flex items-center gap-3 rounded-t-2xl">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <Zap size={18} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#E6EDF3]">Morning Planning</h2>
            <p className="text-xs text-[#484F58]">
              {format(new Date(), 'EEEE, MMMM d')} · Session starts now
            </p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Strategy reminder */}
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <p className="text-xs text-blue-400 font-medium mb-1">Today's Strategy — Double Your Claude Sessions</p>
            <div className="grid grid-cols-3 text-xs text-[#8B949E] gap-2">
              <div>
                <span className="font-mono text-blue-300">{settings?.session1_kickstart ?? '09:00'}</span>
                <span className="block text-[#484F58]">Start prompting → kick 5h timer</span>
              </div>
              <div>
                <span className="font-mono text-emerald-300">{settings?.planning_end ?? '11:00'}</span>
                <span className="block text-[#484F58]">Switch to Claude Code</span>
              </div>
              <div>
                <span className="font-mono text-emerald-300">{settings?.session2_start ?? '14:00'}</span>
                <span className="block text-[#484F58]">Fresh session resets!</span>
              </div>
            </div>
          </div>

          {/* Yesterday's unfinished */}
          {yesterdayTasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">
                Yesterday's Unfinished ({yesterdayTasks.length})
              </h3>
              <div className="space-y-1.5">
                {yesterdayTasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-[#30363D] bg-[#0F1117]">
                    <span className="flex-1 text-xs text-[#8B949E]">{task.title}</span>
                    <button
                      onClick={() => handleCarryYesterday(task)}
                      className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer px-2 py-1 rounded border border-blue-500/30 hover:bg-blue-500/10 transition-colors"
                    >
                      Carry
                    </button>
                    <button
                      onClick={() => handleSkipYesterday(task)}
                      className="text-xs text-[#484F58] hover:text-[#8B949E] cursor-pointer px-2 py-1 rounded hover:bg-[#21262D] transition-colors"
                    >
                      Skip
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick task input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">
                Plan Session 1 Tasks
              </h3>
              <span className="text-xs text-[#484F58]">one task per line</span>
            </div>
            <textarea
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder={`Review PR from yesterday\nImplement user auth endpoint\nWrite tests for payment module`}
              rows={4}
              className="w-full bg-[#0F1117] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm placeholder-[#484F58] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors px-3 py-2 resize-none"
            />
            <Button
              variant="primary"
              icon={<Plus size={13} />}
              onClick={handleBulkAdd}
              loading={addingBulk}
              disabled={!bulkInput.trim()}
              className="w-full"
            >
              Add All Tasks
            </Button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} className="flex-1">
              Close
            </Button>
            <Button
              variant="secondary"
              icon={<ArrowRight size={13} />}
              onClick={onGoToFocus}
              className="flex-1"
            >
              Jump to Focus
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
