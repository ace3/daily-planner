export interface DailyReport {
  id: string;
  date: string;
  tasks_planned: number;
  tasks_completed: number;
  tasks_skipped: number;
  tasks_carried: number;
  total_focus_min: number;
  session1_focus: number;
  session2_focus: number;
  ai_reflection: string | null;
  markdown_export: string | null;
  generated_at: string;
}
