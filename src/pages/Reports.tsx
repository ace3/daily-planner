import React, { useEffect } from 'react';
import { useReportStore } from '../stores/reportStore';
import { useTaskStore } from '../stores/taskStore';
import { useSettingsStore } from '../stores/settingsStore';
import { DailyReportCard } from '../components/reports/DailyReport';
import { WeeklyChart } from '../components/reports/WeeklyChart';
import { StreakCalendar } from '../components/reports/StreakCalendar';
import { ReportExport } from '../components/reports/ReportExport';
import { Button } from '../components/ui/Button';
import { BarChart2, RefreshCw, Sparkles } from 'lucide-react';
import { getLocalDate } from '../lib/time';
import { improvePromptWithClaude } from '../lib/tauri';
import { useProviderStore } from '../stores/providerStore';
import { toast } from '../components/ui/Toast';

export const Reports: React.FC = () => {
  const { report, recentReports, loading, generateReport, fetchReport, fetchRecentReports, saveReflection } = useReportStore();
  const { tasks, fetchTasks, activeDate } = useTaskStore();
  const { settings } = useSettingsStore();
  const { claudeAvailable, activeProvider } = useProviderStore();
  const [generatingReflection, setGeneratingReflection] = React.useState(false);
  const today = getLocalDate(settings?.timezone_offset ?? 7);

  useEffect(() => {
    fetchReport(today);
    fetchRecentReports(30);
    if (today !== activeDate) fetchTasks(today);
  }, [today]);

  const handleGenerate = async () => {
    await generateReport(today);
    toast.success('Report generated');
  };

  const handleAiReflection = async () => {
    if (!report) return;
    setGeneratingReflection(true);
    const doneTasks = tasks.filter((t) => t.status === 'done').map((t) => t.title).join('\n');
    const pendingTasks = tasks.filter((t) => t.status === 'pending').map((t) => t.title).join('\n');
    const prompt = `You are a daily planning assistant. Generate a concise end-of-day reflection (3-4 sentences) based on today's work:

Completed tasks:
${doneTasks || '(none)'}

Pending tasks:
${pendingTasks || '(none)'}

Total focus time: ${report.total_focus_min} minutes
Completion rate: ${report.tasks_planned > 0 ? Math.round((report.tasks_completed / report.tasks_planned) * 100) : 0}%

Write an encouraging, actionable reflection. Mention what went well and what to prioritize tomorrow.`;

    try {
      const reflection = await improvePromptWithClaude(prompt, undefined, activeProvider);
      saveReflection(today, reflection);
      toast.success('AI reflection generated');
    } catch (e) {
      toast.error(`Failed to generate reflection — make sure ${activeProvider} CLI is installed`);
    } finally {
      setGeneratingReflection(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart2 size={16} className="text-gray-500 dark:text-[#8B949E]" />
            <h1 className="text-base font-semibold text-gray-900 dark:text-[#E6EDF3]">Reports</h1>
          </div>
          <div className="flex gap-2">
            {report && claudeAvailable && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Sparkles size={13} />}
                onClick={handleAiReflection}
                loading={generatingReflection}
              >
                AI Reflection
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}
              onClick={handleGenerate}
              loading={loading}
            >
              Generate Today
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
          {/* Left: today's report */}
          <div className="space-y-4">
            {report ? (
              <>
                <DailyReportCard report={report} />
                <ReportExport report={report} tasks={tasks} />
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-[#30363D] p-8 text-center">
                <p className="text-sm text-gray-400 dark:text-[#484F58] mb-3">No report yet for today.</p>
                <Button variant="primary" onClick={handleGenerate} loading={loading}>
                  Generate Report
                </Button>
              </div>
            )}
          </div>

          {/* Right: charts + calendar */}
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4">
              <WeeklyChart reports={recentReports} />
            </div>
            <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4">
              <StreakCalendar reports={recentReports} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
