import React from 'react';
import { CheckCircle, SkipForward, ArrowRight, Clock } from 'lucide-react';
import type { DailyReport as DailyReportType } from '../../types/report';
import { formatDuration } from '../../lib/time';

interface DailyReportProps {
  report: DailyReportType;
}

export const DailyReportCard: React.FC<DailyReportProps> = ({ report }) => {
  const completionRate =
    report.tasks_planned > 0
      ? Math.round((report.tasks_completed / report.tasks_planned) * 100)
      : 0;

  const stats = [
    {
      icon: <CheckCircle size={14} className="text-emerald-400" />,
      label: 'Completed',
      value: report.tasks_completed,
      color: 'text-emerald-400',
    },
    {
      icon: <SkipForward size={14} className="text-amber-400" />,
      label: 'Skipped',
      value: report.tasks_skipped,
      color: 'text-amber-400',
    },
    {
      icon: <ArrowRight size={14} className="text-blue-400" />,
      label: 'Carried',
      value: report.tasks_carried,
      color: 'text-blue-400',
    },
    {
      icon: <Clock size={14} className="text-purple-400" />,
      label: 'Focus',
      value: formatDuration(report.total_focus_min),
      color: 'text-purple-400',
    },
  ];

  return (
    <div className="rounded-xl border border-[#30363D] bg-[#161B22] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">{report.date}</h3>
        <div className="flex items-center gap-2">
          <div className="text-2xl font-bold text-[#E6EDF3]">{completionRate}%</div>
          <div className="text-xs text-[#484F58]">completion</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-[#21262D] rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
          style={{ width: `${completionRate}%` }}
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        {stats.map(({ icon, label, value, color }) => (
          <div key={label} className="flex items-center gap-2 p-2 rounded-lg bg-[#0F1117]">
            {icon}
            <div>
              <div className={`text-sm font-semibold ${color}`}>{value}</div>
              <div className="text-xs text-[#484F58]">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Session split */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-2 rounded-lg bg-[#0F1117]">
          <div className="text-[#484F58] mb-1">Session 1 focus</div>
          <div className="text-[#E6EDF3] font-medium">{formatDuration(report.session1_focus)}</div>
        </div>
        <div className="p-2 rounded-lg bg-[#0F1117]">
          <div className="text-[#484F58] mb-1">Session 2 focus</div>
          <div className="text-[#E6EDF3] font-medium">{formatDuration(report.session2_focus)}</div>
        </div>
      </div>

      {report.ai_reflection && (
        <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
          <div className="text-xs font-medium text-blue-400 mb-1.5">AI Reflection</div>
          <p className="text-xs text-[#8B949E] leading-relaxed">{report.ai_reflection}</p>
        </div>
      )}
    </div>
  );
};
