export type TaskType = 'code' | 'research' | 'prompt' | 'meeting' | 'review' | 'other';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'carried_over';
export type TaskPriority = 1 | 2 | 3; // 1=high, 2=medium, 3=low
export type WorktreeStatus = 'active' | 'merged' | 'abandoned';

export interface Task {
  id: string;
  date: string;
  session_slot: number;
  title: string;
  notes: string;
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  estimated_min: number | null;
  actual_min: number | null;
  prompt_used: string | null;
  prompt_result: string | null;
  carried_from: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  project_id: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  worktree_status: WorktreeStatus | null;
}

export interface CreateTaskInput {
  date: string;
  session_slot: number;
  title: string;
  task_type?: TaskType;
  priority?: TaskPriority;
  estimated_min?: number;
  project_id?: string;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  notes?: string;
  task_type?: TaskType;
  priority?: TaskPriority;
  estimated_min?: number;
  session_slot?: number;
  project_id?: string;
  clear_project?: boolean;
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
