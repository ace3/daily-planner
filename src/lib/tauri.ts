import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  PromptTemplate,
  RunTaskWorktreeResult,
  CleanupTaskWorktreeResult,
  CreatePromptWorktreeResult,
  WorktreeTestResult,
  MergeWorktreeResult,
  CleanupWorktreeResult,
} from '../types/task';
import type { AppSettings, AiProvider } from '../types/settings';
import type { DailyReport } from '../types/report';
import type { Project, CreateProjectInput } from '../types/project';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { isWebBrowser, httpGet, httpPost, httpPatch, httpPut, httpDelete } from './http';

// Thin wrappers — static imports allow vi.mock() to intercept correctly in tests
function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

function tauriOpen(opts: Parameters<typeof dialogOpen>[0]) {
  return dialogOpen(opts);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const getTasks = (date: string): Promise<Task[]> =>
  isWebBrowser()
    ? httpGet<Task[]>('/api/tasks', { date })
    : tauriInvoke<Task[]>('get_tasks', { date });

export const getTasksRange = (from: string, to: string): Promise<Task[]> =>
  isWebBrowser()
    ? httpGet<Task[]>('/api/tasks/range', { from, to })
    : tauriInvoke<Task[]>('get_tasks_range', { from, to });

export const rolloverIncompleteTasks = (date: string): Promise<number> =>
  isWebBrowser()
    ? httpPost<{ rolled_over: number }>('/api/tasks/rollover', { date }).then((r) => r.rolled_over)
    : tauriInvoke<number>('rollover_incomplete_tasks', { date });

export const createTask = (input: CreateTaskInput): Promise<string> =>
  isWebBrowser()
    ? httpPost<{ id: string }>('/api/tasks', input).then((r) => r.id)
    : tauriInvoke<string>('create_task', { input });

export const updateTask = (input: UpdateTaskInput): Promise<void> =>
  isWebBrowser()
    ? httpPatch<void>(`/api/tasks/${input.id}`, input)
    : tauriInvoke<void>('update_task', { input });

export const updateTaskStatus = (id: string, status: string): Promise<void> =>
  isWebBrowser()
    ? httpPatch<void>(`/api/tasks/${id}/status`, { status })
    : tauriInvoke<void>('update_task_status', { id, status });

export const deleteTask = (id: string): Promise<void> =>
  isWebBrowser()
    ? httpDelete<void>(`/api/tasks/${id}`)
    : tauriInvoke<void>('delete_task', { id });

export const carryTaskForward = (id: string, tomorrowDate: string, sessionSlot: number): Promise<string> =>
  isWebBrowser()
    ? httpPost<{ id: string }>(`/api/tasks/${id}/carry-forward`, {
        tomorrow_date: tomorrowDate,
        session_slot: sessionSlot,
      }).then((r) => r.id)
    : tauriInvoke<string>('carry_task_forward', { id, tomorrowDate, sessionSlot });

export const reorderTasks = (taskIds: string[]): Promise<void> =>
  isWebBrowser()
    ? httpPatch<void>('/api/tasks/reorder', { task_ids: taskIds })
    : tauriInvoke<void>('reorder_tasks', { taskIds });

export const savePromptResult = (id: string, promptUsed: string, promptResult: string): Promise<void> =>
  isWebBrowser()
    ? httpPost<void>(`/api/tasks/${id}/prompt-result`, {
        prompt_used: promptUsed,
        prompt_result: promptResult,
      })
    : tauriInvoke<void>('save_prompt_result', { id, promptUsed, promptResult });

export const moveTaskToSession = (taskId: string, targetSession: 1 | 2): Promise<void> =>
  isWebBrowser()
    ? httpPatch<void>(`/api/tasks/${taskId}/move-session`, { target_session: targetSession })
    : tauriInvoke<void>('move_task_to_session', { taskId, targetSession });

// Desktop-only (git worktrees not available in browser)
export const runTaskAsWorktree = (taskId: string): Promise<RunTaskWorktreeResult> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<RunTaskWorktreeResult>('run_task_as_worktree', { taskId });

export const cleanupTaskWorktree = (taskId: string): Promise<CleanupTaskWorktreeResult> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<CleanupTaskWorktreeResult>('cleanup_task_worktree', { taskId });

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const getPromptTemplates = (): Promise<PromptTemplate[]> =>
  isWebBrowser()
    ? httpGet<PromptTemplate[]>('/api/prompt/templates')
    : tauriInvoke<PromptTemplate[]>('get_prompt_templates', {});

export const createPromptTemplate = (name: string, content: string): Promise<PromptTemplate> =>
  isWebBrowser()
    ? httpPost<PromptTemplate>('/api/prompt/templates', { name, content })
    : tauriInvoke<PromptTemplate>('create_prompt_template', { name, content });

export const updatePromptTemplate = (id: string, name: string, content: string): Promise<PromptTemplate> =>
  isWebBrowser()
    ? httpPatch<PromptTemplate>(`/api/prompt/templates/${id}`, { name, content })
    : tauriInvoke<PromptTemplate>('update_prompt_template', { id, name, content });

export const deletePromptTemplate = (id: string): Promise<boolean> =>
  isWebBrowser()
    ? httpDelete<{ ok: boolean }>(`/api/prompt/templates/${id}`).then(() => true)
    : tauriInvoke<boolean>('delete_prompt_template', { id });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const getSettings = (): Promise<AppSettings> =>
  isWebBrowser()
    ? httpGet<AppSettings>('/api/settings')
    : tauriInvoke<AppSettings>('get_settings', {});

export const getSetting = (key: string): Promise<string | null> =>
  isWebBrowser()
    ? httpGet<{ key: string; value: string | null }>(`/api/settings/${key}`).then((r) => r.value)
    : tauriInvoke<string | null>('get_setting', { key });

export const setSetting = (key: string, value: string): Promise<void> =>
  isWebBrowser()
    ? httpPut<void>(`/api/settings/${key}`, { value })
    : tauriInvoke<void>('set_setting', { key, value });

// ---------------------------------------------------------------------------
// CLI / AI providers
// ---------------------------------------------------------------------------

export const improvePromptWithClaude = (
  prompt: string,
  projectPath?: string,
  provider?: string,
  projectId?: string,
  jobId?: string,
): Promise<string> =>
  isWebBrowser()
    ? Promise.reject(new Error('Use SSE streaming in browser mode'))
    : tauriInvoke<string>('improve_prompt_with_claude', { prompt, projectPath, provider, projectId, jobId });

export const invokeCopilotCli = (
  input: string,
  mode: 'suggest' | 'explain' = 'suggest',
  projectPath?: string,
  model?: string,
): Promise<string> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<string>('invoke_copilot_cli', { input, mode, projectPath, model });

export const runPrompt = (
  prompt: string,
  projectPath?: string,
  provider?: string,
  jobId?: string,
): Promise<void> =>
  isWebBrowser()
    ? Promise.reject(new Error('Use SSE streaming in browser mode'))
    : tauriInvoke<void>('run_prompt', { prompt, projectPath, provider, jobId });

export const checkCliAvailability = (): Promise<{ claude_available: boolean; opencode_available: boolean }> =>
  isWebBrowser()
    ? Promise.resolve({ claude_available: false, opencode_available: false })
    : tauriInvoke<{ claude_available: boolean; opencode_available: boolean }>('check_cli_availability', {});

export const checkCopilotCliAvailability = (): Promise<{ available: boolean }> =>
  isWebBrowser()
    ? Promise.resolve({ available: false })
    : tauriInvoke<{ available: boolean }>('check_copilot_cli_availability', {});

export const detectAiProviders = (): Promise<AiProvider[]> =>
  isWebBrowser()
    ? Promise.resolve([])
    : tauriInvoke<AiProvider[]>('detect_ai_providers', {});

export const isGitWorktree = (projectPath: string): Promise<boolean> =>
  isWebBrowser()
    ? Promise.resolve(false)
    : tauriInvoke<boolean>('is_git_worktree', { projectPath });

// ---------------------------------------------------------------------------
// Data management (desktop only)
// ---------------------------------------------------------------------------

export const backupData = (): Promise<string> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<string>('backup_data', {});

export const restoreData = (): Promise<string> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<string>('restore_data', {});

export const resetAppData = (keepSettings: boolean, keepBuiltinTemplates: boolean): Promise<void> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<void>('reset_app_data', { keepSettings, keepBuiltinTemplates });

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const getProjects = (): Promise<Project[]> =>
  isWebBrowser()
    ? httpGet<Project[]>('/api/projects')
    : tauriInvoke<Project[]>('get_projects', {});

export const createProject = (input: CreateProjectInput): Promise<string> =>
  isWebBrowser()
    ? httpPost<{ id: string }>('/api/projects', input).then((r) => r.id)
    : tauriInvoke<string>('create_project', { input });

export const deleteProject = (id: string): Promise<void> =>
  isWebBrowser()
    ? httpDelete<void>(`/api/projects/${id}`)
    : tauriInvoke<void>('delete_project', { id });

export const getProjectPrompt = (id: string): Promise<string | null> =>
  isWebBrowser()
    ? httpGet<{ prompt: string | null }>(`/api/projects/${id}/prompt`).then((r) => r.prompt)
    : tauriInvoke<string | null>('get_project_prompt', { id });

export const setProjectPrompt = (id: string, prompt: string): Promise<void> =>
  isWebBrowser()
    ? httpPut<void>(`/api/projects/${id}/prompt`, { prompt })
    : tauriInvoke<void>('set_project_prompt', { id, prompt });

export const openFolderDialog = (): Promise<string | null> =>
  isWebBrowser()
    ? Promise.resolve(null)
    : tauriOpen({ directory: true, multiple: false }).then((r) => (typeof r === 'string' ? r : null));

// ---------------------------------------------------------------------------
// Global prompt
// ---------------------------------------------------------------------------

export const getGlobalPrompt = (): Promise<string | null> =>
  isWebBrowser()
    ? httpGet<{ prompt: string | null }>('/api/prompt/global').then((r) => r.prompt)
    : tauriInvoke<string | null>('get_global_prompt', {});

export const setGlobalPrompt = (prompt: string): Promise<void> =>
  isWebBrowser()
    ? httpPut<void>('/api/prompt/global', { prompt })
    : tauriInvoke<void>('set_global_prompt', { prompt });

// ---------------------------------------------------------------------------
// Git (desktop only)
// ---------------------------------------------------------------------------

export interface GitFileStatus {
  status: string;
  path: string;
}
export interface GitStatusResult {
  branch: string;
  files: GitFileStatus[];
}

export const gitStatus = (projectPath: string): Promise<GitStatusResult> =>
  isWebBrowser()
    ? Promise.resolve({ branch: '', files: [] })
    : tauriInvoke<GitStatusResult>('git_status', { projectPath });

export const gitDiff = (projectPath: string): Promise<string> =>
  isWebBrowser()
    ? Promise.resolve('')
    : tauriInvoke<string>('git_diff', { projectPath });

export const gitStageAll = (projectPath: string): Promise<void> =>
  isWebBrowser()
    ? Promise.resolve()
    : tauriInvoke<void>('git_stage_all', { projectPath });

export const gitCommit = (projectPath: string, message: string): Promise<void> =>
  isWebBrowser()
    ? Promise.resolve()
    : tauriInvoke<void>('git_commit', { projectPath, message });

export const gitPush = (projectPath: string): Promise<string> =>
  isWebBrowser()
    ? Promise.resolve('')
    : tauriInvoke<string>('git_push', { projectPath });

// ---------------------------------------------------------------------------
// Prompt worktree lifecycle (desktop only)
// ---------------------------------------------------------------------------

export const createPromptWorktree = (
  promptId: string,
  projectPath: string,
  baseBranch?: string,
): Promise<CreatePromptWorktreeResult> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<CreatePromptWorktreeResult>('create_prompt_worktree', {
        promptId,
        projectPath,
        baseBranch,
      });

export const runTestsInWorktree = (worktreePath: string, jobId: string): Promise<WorktreeTestResult> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<WorktreeTestResult>('run_tests_in_worktree', { worktreePath, jobId });

export const mergeWorktreeBranch = (
  projectPath: string,
  branchName: string,
  targetBranch: string,
): Promise<MergeWorktreeResult> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<MergeWorktreeResult>('merge_worktree_branch', {
        projectPath,
        branchName,
        targetBranch,
      });

export const cleanupPromptWorktree = (
  projectPath: string,
  worktreePath: string,
  branchName: string,
): Promise<CleanupWorktreeResult> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<CleanupWorktreeResult>('cleanup_prompt_worktree', {
        projectPath,
        worktreePath,
        branchName,
      });

// ---------------------------------------------------------------------------
// Remote access (HTTP server)
// ---------------------------------------------------------------------------

export const getLocalIp = (): Promise<string> =>
  isWebBrowser()
    ? Promise.resolve(window.location.hostname)
    : tauriInvoke<string>('get_local_ip', {});

export const getHttpServerPort = (): Promise<number> =>
  isWebBrowser()
    ? Promise.resolve(parseInt(window.location.port || '7734', 10))
    : tauriInvoke<number>('get_http_server_port', {});

// ---------------------------------------------------------------------------
// Auto backup (desktop only)
// ---------------------------------------------------------------------------

export interface BackupSessionInfo {
  id: string;
  created_at: string;
  schema_version: number;
  backup_size: number;
  item_count: number;
  integrity_status: 'verified' | 'corrupted' | 'unknown';
  checksum: string;
  file_path: string;
}

export interface BackupSettings {
  enabled: boolean;
  interval_min: number;
  max_sessions: number;
}

export const triggerBackupNow = (): Promise<BackupSessionInfo> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<BackupSessionInfo>('trigger_backup_now', {});

export const listBackupSessions = (): Promise<BackupSessionInfo[]> =>
  isWebBrowser()
    ? Promise.resolve([])
    : tauriInvoke<BackupSessionInfo[]>('list_backup_sessions', {});

export const verifyBackupSession = (sessionId: string): Promise<BackupSessionInfo> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<BackupSessionInfo>('verify_backup_session', { sessionId });

export const verifyAllBackupSessions = (): Promise<BackupSessionInfo[]> =>
  isWebBrowser()
    ? Promise.resolve([])
    : tauriInvoke<BackupSessionInfo[]>('verify_all_backup_sessions', {});

export const restoreFromBackupSession = (sessionId: string): Promise<string> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<string>('restore_from_backup_session', { sessionId });

export const deleteBackupSession = (sessionId: string): Promise<void> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<void>('delete_backup_session', { sessionId });

export const getBackupSettings = (): Promise<BackupSettings> =>
  isWebBrowser()
    ? Promise.resolve({ enabled: false, interval_min: 30, max_sessions: 5 })
    : tauriInvoke<BackupSettings>('get_backup_settings', {});

export const setBackupSettings = (
  enabled: boolean,
  intervalMin: number,
  maxSessions: number,
): Promise<void> =>
  isWebBrowser()
    ? Promise.resolve()
    : tauriInvoke<void>('set_backup_settings', { enabled, intervalMin, maxSessions });

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const generateReport = (date: string): Promise<DailyReport> =>
  isWebBrowser()
    ? httpPost<DailyReport>(`/api/reports/${date}/generate`)
    : tauriInvoke<DailyReport>('generate_report', { date });

export const getReport = (date: string): Promise<DailyReport | null> =>
  isWebBrowser()
    ? httpGet<DailyReport | null>(`/api/reports/${date}`)
    : tauriInvoke<DailyReport | null>('get_report', { date });

export const getReportsRange = (from: string, to: string): Promise<DailyReport[]> =>
  isWebBrowser()
    ? httpGet<DailyReport[]>('/api/reports', { from, to })
    : tauriInvoke<DailyReport[]>('get_reports_range', { from, to });

export const saveAiReflection = (date: string, reflection: string): Promise<void> =>
  isWebBrowser()
    ? httpPost<void>(`/api/reports/${date}/reflection`, { reflection })
    : tauriInvoke<void>('save_ai_reflection', { date, reflection });

// ---------------------------------------------------------------------------
// Devices (Phase 4)
// ---------------------------------------------------------------------------

export interface Device {
  id: string;
  name: string;
  last_seen: string | null;
  created_at: string;
}

export const listDevices = (): Promise<Device[]> =>
  isWebBrowser()
    ? httpGet<Device[]>('/api/devices')
    : tauriInvoke<Device[]>('list_devices');

export const registerDevice = (id: string, name: string): Promise<Device> =>
  isWebBrowser()
    ? httpPost<Device>('/api/devices/register', { id, name })
    : tauriInvoke<Device>('register_device', { id, name });

export const deleteDevice = (id: string): Promise<void> =>
  isWebBrowser()
    ? httpDelete<void>(`/api/devices/${id}`)
    : tauriInvoke<void>('delete_device', { id });

// ---------------------------------------------------------------------------
// Cloudflare Tunnel (Phase 5)
// ---------------------------------------------------------------------------

export interface TunnelStatus {
  running: boolean;
  url: string | null;
  error: string | null;
}

export const startTunnel = (port: number): Promise<TunnelStatus> =>
  isWebBrowser()
    ? Promise.resolve({ running: false, url: null, error: 'Not available in browser mode' })
    : tauriInvoke<TunnelStatus>('start_tunnel_cmd', { port });

export const stopTunnel = (): Promise<TunnelStatus> =>
  isWebBrowser()
    ? Promise.resolve({ running: false, url: null, error: null })
    : tauriInvoke<TunnelStatus>('stop_tunnel_cmd');

export const getTunnelStatus = (): Promise<TunnelStatus> =>
  isWebBrowser()
    ? Promise.resolve({ running: false, url: null, error: null })
    : tauriInvoke<TunnelStatus>('get_tunnel_status');
