import React from 'react';
import type { DailyReport } from '../../types/report';

interface StreakCalendarProps {
  reports: DailyReport[];
}

export const StreakCalendar: React.FC<StreakCalendarProps> = ({ reports }) => {
  const reportMap = new Map(reports.map((r) => [r.date, r]));

  // Generate last 35 days (5 weeks)
  const days = Array.from({ length: 35 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (34 - i));
    return d.toISOString().split('T')[0];
  });

  const getColor = (date: string): string => {
    const report = reportMap.get(date);
    if (!report) return '#21262D';
    const rate =
      report.tasks_planned > 0 ? report.tasks_completed / report.tasks_planned : 0;
    if (rate >= 0.8) return '#10B981';
    if (rate >= 0.5) return '#F59E0B';
    if (rate > 0) return '#484F58';
    return '#21262D';
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">
        Activity (last 35 days)
      </h4>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => (
          <div
            key={d}
            title={`${d}: ${reportMap.get(d)?.tasks_completed ?? 0} completed`}
            className="w-full aspect-square rounded-sm"
            style={{ backgroundColor: getColor(d) }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-[#484F58]">
        <div className="w-3 h-3 rounded-sm bg-[#21262D]" /> None
        <div className="w-3 h-3 rounded-sm bg-[#484F58]" /> Low
        <div className="w-3 h-3 rounded-sm bg-amber-500" /> Med
        <div className="w-3 h-3 rounded-sm bg-emerald-500" /> High
      </div>
    </div>
  );
};
