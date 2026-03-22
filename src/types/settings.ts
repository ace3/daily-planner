export interface AppSettings {
  timezone_offset: number;
  session1_kickstart: string; // "HH:MM"
  planning_end: string;       // "HH:MM"
  session2_start: string;     // "HH:MM"
  warn_before_min: number;
  autostart: boolean;
  claude_model: string;
  theme: string;
  work_days: number[];
  show_in_tray: boolean;
  pomodoro_work_min: number;
  pomodoro_break_min: number;
}
