import React from 'react';
import { Download, Copy } from 'lucide-react';
import { Button } from '../ui/Button';
import { reportToMarkdown } from '../../lib/markdown';
import type { DailyReport } from '../../types/report';
import type { Task } from '../../types/task';
import { toast } from '../ui/Toast';

interface ReportExportProps {
  report: DailyReport;
  tasks: Task[];
}

export const ReportExport: React.FC<ReportExportProps> = ({ report, tasks }) => {
  const markdown = reportToMarkdown(report, tasks, report.date);

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown);
    toast.success('Report copied to clipboard');
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-report-${report.date}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report downloaded');
  };

  return (
    <div className="flex gap-2">
      <Button variant="secondary" size="sm" icon={<Copy size={12} />} onClick={handleCopy}>
        Copy Markdown
      </Button>
      <Button variant="secondary" size="sm" icon={<Download size={12} />} onClick={handleDownload}>
        Download .md
      </Button>
    </div>
  );
};
