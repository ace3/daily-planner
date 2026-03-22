import React, { useEffect, useState } from 'react';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import { SessionTimer } from '../components/session/SessionTimer';
import { SessionWarning } from '../components/session/SessionWarning';
import { TaskList } from '../components/tasks/TaskList';
import { useSessionTimer } from '../hooks/useSessionTimer';
import { usePhaseListener } from '../hooks/useNotifications';
import { getLocalDate } from '../lib/time';
import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const Dashboard: React.FC = () => {
  const { fetchTasks, tasks, activeDate } = useTaskStore();
  const { settings } = useSettingsStore();
  const [loading, setLoading] = useState(false);

  useSessionTimer();
  usePhaseListener();

  const today = getLocalDate(settings?.timezone_offset ?? 7);

  useEffect(() => {
    if (today && today !== activeDate) {
      setLoading(true);
      fetchTasks(today).finally(() => setLoading(false));
    }
  }, [today]);

  const completedToday = tasks.filter((t) => t.status === 'done').length;
  const totalToday = tasks.filter((t) => t.status !== 'carried_over').length;
  const completionPct = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-[#E6EDF3]">
            {format(new Date(), 'EEEE, MMMM d')}
          </h1>
          <p className="text-xs text-[#484F58] mt-0.5">
            {completedToday}/{totalToday} tasks done
            {totalToday > 0 && ` · ${completionPct}%`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right text-xs text-[#484F58]">
            <div className="font-mono">{today}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}
            onClick={() => fetchTasks(today)}
          />
        </div>
      </div>

      {/* Session warning banner */}
      <SessionWarning />

      {/* Bento grid: timer + tasks */}
      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4">
        {/* Left: Session Timer */}
        <div className="space-y-3">
          <SessionTimer />

          {/* Daily progress */}
          {totalToday > 0 && (
            <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">
                  Today's Progress
                </span>
                <span className="text-sm font-bold text-[#E6EDF3]">{completionPct}%</span>
              </div>
              <div className="h-2 bg-[#21262D] rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
              <div className="mt-2 grid grid-cols-3 text-center text-xs text-[#484F58]">
                <div>
                  <div className="text-emerald-400 font-semibold">
                    {tasks.filter((t) => t.status === 'done').length}
                  </div>
                  Done
                </div>
                <div>
                  <div className="text-amber-400 font-semibold">
                    {tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length}
                  </div>
                  Active
                </div>
                <div>
                  <div className="text-[#8B949E] font-semibold">
                    {tasks.filter((t) => t.status === 'skipped').length}
                  </div>
                  Skipped
                </div>
              </div>
            </div>
          )}

          {/* Phase guide */}
          <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 space-y-2">
            <span className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">
              Daily Strategy
            </span>
            {[
              { time: settings?.session1_kickstart ?? '09:00', label: 'Start prompting', desc: 'Kickstart 5-hour session', color: '#3B82F6' },
              { time: settings?.planning_end ?? '11:00', label: 'Switch to Claude Code', desc: 'Begin development', color: '#10B981' },
              { time: settings?.session2_start ?? '14:00', label: 'Fresh session!', desc: 'Session resets — double usage', color: '#10B981' },
              { time: '19:00', label: 'Wrap up', desc: 'Generate daily report', color: '#8B949E' },
            ].map(({ time, label, desc, color }) => (
              <div key={time} className="flex items-start gap-2.5">
                <span className="font-mono text-xs font-medium w-11 shrink-0 mt-0.5" style={{ color }}>
                  {time}
                </span>
                <div>
                  <div className="text-xs font-medium text-[#E6EDF3]">{label}</div>
                  <div className="text-xs text-[#484F58]">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Task lists */}
        <div className="space-y-6 min-w-0">
          <TaskList slot={1} />
          <div className="border-t border-[#21262D]" />
          <TaskList slot={2} />
        </div>
      </div>
    </div>
  );
};
