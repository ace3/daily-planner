import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  PromptTemplate,
  RunTaskWorktreeResult,
  CleanupTaskWorktreeResult,
} from '../types/task';
import type { AppSettings, AiProvider } from '../types/settings';
import type { DailyReport } from '../types/report';
import type { Project, CreateProjectInput } from '../types/project';

// Tasks
export const getTasks = (date: string) => invoke<Task[]>('get_tasks', { date });
export const createTask = (input: CreateTaskInput) => invoke<string>('create_task', { input });
export const updateTask = (input: UpdateTaskInput) => invoke<void>('update_task', { input });
export const updateTaskStatus = (id: string, status: string) => invoke<void>('update_task_status', { id, status });
export const deleteTask = (id: string) => invoke<void>('delete_task', { id });
export const carryTaskForward = (id: string, tomorrowDate: string, sessionSlot: number) =>
  invoke<string>('carry_task_forward', { id, tomorrowDate, sessionSlot });
export const reorderTasks = (taskIds: string[]) => invoke<void>('reorder_tasks', { taskIds });
export const savePromptResult = (id: string, promptUsed: string, promptResult: string) =>
  invoke<void>('save_prompt_result', { id, promptUsed, promptResult });
export const runTaskAsWorktree = (taskId: string) =>
  invoke<RunTaskWorktreeResult>('run_task_as_worktree', { taskId });
export const cleanupTaskWorktree = (taskId: string) =>
  invoke<CleanupTaskWorktreeResult>('cleanup_task_worktree', { taskId });

// Focus sessions
export const startFocusSession = (taskId: string, date: string) =>
  invoke<string>('start_focus_session', { taskId, date });
export const endFocusSession = (sessionId: string, notes: string) =>
  invoke<number>('end_focus_session', { sessionId, notes });

// Templates
export const getPromptTemplates = () => invoke<PromptTemplate[]>('get_prompt_templates', {});
export const createPromptTemplate = (name: string, content: string) =>
  invoke<PromptTemplate>('create_prompt_template', { name, content });
export const updatePromptTemplate = (id: string, name: string, content: string) =>
  invoke<PromptTemplate>('update_prompt_template', { id, name, content });
export const deletePromptTemplate = (id: string) =>
  invoke<boolean>('delete_prompt_template', { id });

// Settings
export const getSettings = () => invoke<AppSettings>('get_settings', {});
export const getSetting = (key: string) => invoke<string | null>('get_setting', { key });
export const setSetting = (key: string, value: string) => invoke<void>('set_setting', { key, value });

// CLI / AI providers
export const improvePromptWithClaude = (prompt: string, projectPath?: string, provider?: string, projectId?: string) =>
  invoke<string>('improve_prompt_with_claude', { prompt, projectPath, provider, projectId });
export const invokeCopilotCli = (
  input: string,
  mode: 'suggest' | 'explain' = 'suggest',
  projectPath?: string,
  model?: string,
) => invoke<string>('invoke_copilot_cli', { input, mode, projectPath, model });

export const runPrompt = (prompt: string, projectPath?: string, provider?: string, jobId?: string) =>
  invoke<void>('run_prompt', { prompt, projectPath, provider, jobId });

export const checkCliAvailability = () =>
  invoke<{ claude_available: boolean; opencode_available: boolean }>('check_cli_availability', {});
export const checkCopilotCliAvailability = () =>
  invoke<{ available: boolean }>('check_copilot_cli_availability', {});
export const detectAiProviders = () => invoke<AiProvider[]>('detect_ai_providers', {});
export const isGitWorktree = (projectPath: string) =>
  invoke<boolean>('is_git_worktree', { projectPath });

// Data management
export const backupData = () => invoke<string>('backup_data', {});
export const restoreData = () => invoke<string>('restore_data', {});
export const resetAppData = (keepSettings: boolean, keepBuiltinTemplates: boolean) =>
  invoke<void>('reset_app_data', { keepSettings, keepBuiltinTemplates });

// Projects
export const getProjects = () => invoke<Project[]>('get_projects', {});
export const createProject = (input: CreateProjectInput) => invoke<string>('create_project', { input });
export const deleteProject = (id: string) => invoke<void>('delete_project', { id });
export const getProjectPrompt = (id: string) => invoke<string | null>('get_project_prompt', { id });
export const setProjectPrompt = (id: string, prompt: string) => invoke<void>('set_project_prompt', { id, prompt });
export const openFolderDialog = (): Promise<string | null> =>
  open({ directory: true, multiple: false }).then((r) => (typeof r === 'string' ? r : null));

// Global / project prompts
export const getGlobalPrompt = () => invoke<string | null>('get_global_prompt', {});
export const setGlobalPrompt = (prompt: string) => invoke<void>('set_global_prompt', { prompt });

// Reports
export const generateReport = (date: string) => invoke<DailyReport>('generate_report', { date });
export const getReport = (date: string) => invoke<DailyReport | null>('get_report', { date });
export const getReportsRange = (from: string, to: string) => invoke<DailyReport[]>('get_reports_range', { from, to });
export const saveAiReflection = (date: string, reflection: string) =>
  invoke<void>('save_ai_reflection', { date, reflection });
