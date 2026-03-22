export type TaskType = 'code' | 'research' | 'prompt' | 'meeting' | 'review' | 'other';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'carried_over';
export type TaskPriority = 1 | 2 | 3; // 1=high, 2=medium, 3=low

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
  category: string;
  template: string;
  variables: string; // JSON array string
  is_builtin: boolean;
  use_count: number;
  created_at: string;
}
