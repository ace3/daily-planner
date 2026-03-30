export type JobStatusType = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface PromptJob {
  id: string;
  task_id: string;
  project_id: string | null;
  provider: string;
  prompt: string;
  output: string | null;
  status: JobStatusType;
  exit_code: number | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}
