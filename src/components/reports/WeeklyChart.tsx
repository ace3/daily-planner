import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { DailyReport } from '../../types/report';
import { format, parseISO } from 'date-fns';

interface WeeklyChartProps {
  reports: DailyReport[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-2 text-xs">
      <p className="text-[#8B949E] mb-1">{label}</p>
      <p className="text-emerald-400">{payload[0]?.value} tasks done</p>
      {payload[1] && <p className="text-blue-400">{payload[1]?.value}m focus</p>}
    </div>
  );
};

export const WeeklyChart: React.FC<WeeklyChartProps> = ({ reports }) => {
  const data = reports
    .slice(0, 7)
    .reverse()
    .map((r) => ({
      day: format(parseISO(r.date + 'T00:00:00'), 'EEE'),
      completed: r.tasks_completed,
      focus: r.total_focus_min,
      rate:
        r.tasks_planned > 0
          ? Math.round((r.tasks_completed / r.tasks_planned) * 100)
          : 0,
    }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-[#484F58]">
        No data yet — complete your first session to see charts.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Last 7 Days</h4>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} barSize={20} barGap={4}>
          <XAxis
            dataKey="day"
            tick={{ fill: '#484F58', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="completed" radius={[4, 4, 0, 0]} fill="#10B981">
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.rate >= 80 ? '#10B981' : entry.rate >= 50 ? '#F59E0B' : '#484F58'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
