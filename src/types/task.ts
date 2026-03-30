export type TaskType = 'research' | 'prompt' | 'meeting' | 'review' | 'other';
export type TaskStatus = 'todo' | 'improved' | 'planned' | 'in_progress' | 'review' | 'skipped' | 'carried_over';
export type TaskPriority = 1 | 2 | 3; // 1=high, 2=medium, 3=low
export type WorktreeStatus = 'active' | 'merged' | 'abandoned';
export type JobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';
export type ReviewStatus = 'none' | 'pending' | 'approved' | 'needs_fix';
export type AgentProvider = 'claude' | 'codex' | 'opencode' | 'copilot';

/** The five kanban column statuses (in display order). */
export const KANBAN_STATUSES: TaskStatus[] = ['todo', 'improved', 'planned', 'in_progress', 'review'];

/** Side statuses that don't appear as kanban columns. */
export const SIDE_STATUSES: TaskStatus[] = ['skipped', 'carried_over'];

export interface Task {
  id: string;
  title: string;
  description: string;
  notes: string;
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  estimated_min: number | null;
  actual_min: number | null;
  raw_prompt: string | null;
  improved_prompt: string | null;
  prompt_output: string | null;
  job_status: JobStatus;
  job_id: string | null;
  provider: string | null;
  carried_from: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  project_id: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  worktree_status: WorktreeStatus | null;
  deadline: string | null;
  plan: string | null;
  review_output: string | null;
  review_status: ReviewStatus;
  git_workflow: boolean;
  agent: AgentProvider | null;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  task_type?: TaskType;
  priority?: TaskPriority;
  estimated_min?: number;
  project_id?: string;
  deadline?: string;
  agent?: AgentProvider;
  git_workflow?: boolean;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  description?: string;
  notes?: string;
  task_type?: TaskType;
  priority?: TaskPriority;
  estimated_min?: number;
  project_id?: string;
  clear_project?: boolean;
  deadline?: string | null;
  agent?: AgentProvider | null;
  git_workflow?: boolean;
}

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
}

export interface RunTaskWorktreeResult {
  task_id: string;
  worktree_path: string;
  branch_name: string;
  status: WorktreeStatus;
  launch_command: string;
  prompt_to_run: string;
}

export interface CleanupTaskWorktreeResult {
  task_id: string;
  worktree_path: string | null;
  branch_name: string | null;
  status: WorktreeStatus;
  branch_deleted: boolean;
  warning: string | null;
}

export interface CreatePromptWorktreeResult {
  worktree_path: string;
  branch_name: string;
}

export interface WorktreeTestResult {
  passed: boolean;
  frontend_passed: number;
  frontend_failed: number;
  rust_passed: number;
  rust_failed: number;
}

export interface MergeWorktreeResult {
  success: boolean;
  message: string;
}

export interface CleanupWorktreeResult {
  success: boolean;
  message: string;
}

export interface TaskAttachmentInput {
  source: 'clipboard' | 'path';
  path?: string;
  mime?: string;
  size?: number;
  data_base64?: string;
}

export interface BrainstormTaskSuggestion {
  title: string;
  description: string;
  checklist: string[];
  priority: TaskPriority;
  project?: string | null;
}
