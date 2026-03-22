export type AiProviderId = 'claude' | 'codex' | 'opencode' | 'copilot';

export interface AppSettings {
  timezone_offset: number;
  session1_kickstart: string; // "HH:MM"
  planning_end: string;       // "HH:MM"
  session2_start: string;     // "HH:MM"
  warn_before_min: number;
  autostart: boolean;
  claude_model: string;
  default_model_codex: string;
  default_model_claude: string;
  default_model_opencode: string;
  default_model_copilot: string;
  active_ai_provider: AiProviderId;
  ai_provider: 'claude' | 'opencode' | 'codex' | 'copilot_cli';
  theme: string;
  work_days: number[];
  show_in_tray: boolean;
}

export interface AiProvider {
  id: AiProviderId;
  name: string;
  available: boolean;
}
