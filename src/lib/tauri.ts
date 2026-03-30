import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  PromptTemplate,
  BrainstormTaskSuggestion,
  TaskAttachmentInput,
  RunTaskWorktreeResult,
  CleanupTaskWorktreeResult,
  CreatePromptWorktreeResult,
  WorktreeTestResult,
  MergeWorktreeResult,
  CleanupWorktreeResult,
} from '../types/task';
import type { AppSettings, AiProvider } from '../types/settings';
import type { Project, CreateProjectInput } from '../types/project';
import type { PromptJob } from '../types/job';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { isWebBrowser, httpGet, httpPost, httpPostSse, httpPatch, httpPut, httpDelete } from './http';

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

export const getTasks = (): Promise<Task[]> =>
  isWebBrowser()
    ? httpGet<Task[]>('/api/tasks')
    : tauriInvoke<Task[]>('get_tasks', {});

export const getTask = async (id: string): Promise<Task | null> => {
  try {
    if (isWebBrowser()) {
      return await httpGet<Task>(`/api/tasks/${id}`);
    }
    return await tauriInvoke<Task | null>('get_task', { id });
  } catch (e) {
    console.warn('[getTask] primary lookup failed, falling back to getTasks():', e);
    // Fallback: fetch all tasks and find by id
    try {
      const all = await getTasks();
      return all.find((t) => t.id === id) ?? null;
    } catch (e2) {
      console.error('[getTask] fallback also failed:', e2);
      return null;
    }
  }
};

export const getTasksRange = (from: string, to: string): Promise<Task[]> =>
  isWebBrowser()
    ? httpGet<Task[]>('/api/tasks/range', { from, to })
    : tauriInvoke<Task[]>('get_tasks_range', { from, to });

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

export const carryTaskForward = (id: string, tomorrowDate: string): Promise<string> =>
  isWebBrowser()
    ? httpPost<{ id: string }>(`/api/tasks/${id}/carry-forward`, {
        tomorrow_date: tomorrowDate,
      }).then((r) => r.id)
    : tauriInvoke<string>('carry_task_forward', { id, tomorrowDate });

export const reorderTasks = (taskIds: string[]): Promise<void> =>
  isWebBrowser()
    ? httpPatch<void>('/api/tasks/reorder', { task_ids: taskIds })
    : tauriInvoke<void>('reorder_tasks', { taskIds });

export const savePromptResult = (id: string, rawPrompt: string, improvedPrompt: string): Promise<void> =>
  isWebBrowser()
    ? httpPost<void>(`/api/tasks/${id}/prompt-result`, {
        raw_prompt: rawPrompt,
        improved_prompt: improvedPrompt,
      })
    : tauriInvoke<void>('save_prompt_result', { id, rawPrompt, improvedPrompt });

export const brainstormTasksFromNotes = (
  notes: string,
  attachments: TaskAttachmentInput[] = [],
  provider?: string,
  projectPath?: string,
): Promise<BrainstormTaskSuggestion[]> =>
  isWebBrowser()
    ? httpPost<BrainstormTaskSuggestion[]>('/api/tasks/brainstorm', {
        notes,
        attachments,
        provider,
        project_path: projectPath,
      })
    : tauriInvoke<BrainstormTaskSuggestion[]>('brainstorm_tasks_from_notes', {
        notes,
        attachments,
        provider,
        projectPath,
      });

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

/** Parse fields that the HTTP API returns as raw JSON strings but the Tauri command returns as typed values. */
function normalizeHttpSettings(raw: Record<string, unknown>): AppSettings {
  return {
    ...raw,
    work_days: Array.isArray(raw.work_days)
      ? raw.work_days
      : typeof raw.work_days === 'string'
        ? JSON.parse(raw.work_days)
        : [1, 2, 3, 4, 5],
  } as AppSettings;
}

export const getSettings = (): Promise<AppSettings> =>
  isWebBrowser()
    ? httpGet<Record<string, unknown>>('/api/settings').then(normalizeHttpSettings)
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

export const generatePlan = (
  taskId: string,
  taskTitle: string,
  prompt: string,
  projectPath?: string,
  provider?: string,
  projectId?: string,
): Promise<string> =>
  isWebBrowser()
    ? httpPost<{ plan: string }>(`/api/tasks/${taskId}/generate-plan`, { provider }).then((r) => r.plan)
    : tauriInvoke<string>('generate_plan', { taskId, taskTitle, prompt, projectPath, provider, projectId });

export const reviewTask = (taskId: string, provider?: string): Promise<string> =>
  isWebBrowser()
    ? httpPost<{ review: string }>(`/api/tasks/${taskId}/review`, { provider }).then((r) => r.review)
    : tauriInvoke<string>('review_task', { taskId, provider });

export const approveTaskReview = (taskId: string): Promise<void> =>
  isWebBrowser()
    ? httpPost<void>(`/api/tasks/${taskId}/review/approve`, {})
    : tauriInvoke<void>('approve_task_review', { taskId });

export const fixFromReview = (
  taskId: string,
  provider?: string,
  projectPath?: string,
): Promise<string> =>
  isWebBrowser()
    ? httpPost<{ job_id: string }>(`/api/tasks/${taskId}/fix-review`, { provider, projectPath }).then((r) => r.job_id)
    : tauriInvoke<string>('fix_from_review', { taskId, provider, projectPath });

export const improvePromptWithClaude = (
  prompt: string,
  projectPath?: string,
  provider?: string,
  projectId?: string,
  jobId?: string,
  onChunk?: (partial: string) => void,
): Promise<string> =>
  isWebBrowser()
    ? httpPostSse('/api/prompt/improve', { prompt, provider, project_path: projectPath, project_id: projectId }, onChunk)
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
    ? httpPostSse('/api/prompt/run', { prompt, provider, project_path: projectPath, job_id: jobId }).then(() => {})
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
    ? httpGet<AiProvider[]>('/api/ai-providers')
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

export const getTrashedProjects = (): Promise<Project[]> =>
  isWebBrowser()
    ? httpGet<Project[]>('/api/projects/trash')
    : tauriInvoke<Project[]>('get_trashed_projects', {});

export const createProject = (input: CreateProjectInput): Promise<string> =>
  isWebBrowser()
    ? httpPost<{ id: string }>('/api/projects', input).then((r) => r.id)
    : tauriInvoke<string>('create_project', { input });

export const deleteProject = (id: string): Promise<void> =>
  isWebBrowser()
    ? httpDelete<void>(`/api/projects/${id}`)
    : tauriInvoke<void>('delete_project', { id });

export const restoreProject = (id: string): Promise<void> =>
  isWebBrowser()
    ? httpPost<void>(`/api/projects/${id}/restore`, {})
    : tauriInvoke<void>('restore_project', { id });

export const hardDeleteProject = (id: string): Promise<void> =>
  isWebBrowser()
    ? httpDelete<void>(`/api/projects/${id}/hard`)
    : tauriInvoke<void>('hard_delete_project', { id });

export const getProjectPrompt = (id: string): Promise<string | null> =>
  isWebBrowser()
    ? httpGet<{ prompt: string | null }>(`/api/projects/${id}/prompt`).then((r) => r.prompt)
    : tauriInvoke<string | null>('get_project_prompt', { id });

export const setProjectPrompt = (id: string, prompt: string): Promise<void> =>
  isWebBrowser()
    ? httpPut<void>(`/api/projects/${id}/prompt`, { prompt })
    : tauriInvoke<void>('set_project_prompt', { id, prompt });

export interface ProjectPathValidation {
  exists: boolean;
  is_directory: boolean;
  normalized_path: string;
}

function validateProjectPathInBrowser(path: string): ProjectPathValidation {
  const normalized = path.trim().replace(/\\/g, '/');
  const looksAbsolute =
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith('~');
  return {
    exists: normalized.length > 0 && looksAbsolute,
    is_directory: normalized.length > 0 && looksAbsolute,
    normalized_path: normalized,
  };
}

export const validateProjectPath = (path: string): Promise<ProjectPathValidation> =>
  isWebBrowser()
    ? httpPost<ProjectPathValidation>('/api/projects/validate-path', { path })
        .catch(() => validateProjectPathInBrowser(path))
    : tauriInvoke<ProjectPathValidation>('validate_project_path', { path });

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

export const getHttpAuthToken = (): Promise<string> =>
  isWebBrowser()
    ? httpGet<{ token: string | null }>('/api/remote/auth-token').then((r) => r.token ?? '')
    : getSetting('http_auth_token').then((v) => v ?? '');

export const regenerateHttpAuthToken = (): Promise<string> =>
  isWebBrowser()
    ? httpPost<{ token: string }>('/api/remote/auth-token/regenerate', {}).then((r) => r.token ?? '')
    : (() => {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        const token = Array.from(array).map((b) => b.toString(16).padStart(2, '0')).join('');
        return setSetting('http_auth_token', token).then(() => token);
      })();

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
    ? httpPost<TunnelStatus>('/api/tunnel/start', { port })
    : tauriInvoke<TunnelStatus>('start_tunnel_cmd', { port });

export const stopTunnel = (): Promise<TunnelStatus> =>
  isWebBrowser()
    ? httpPost<TunnelStatus>('/api/tunnel/stop', {})
    : tauriInvoke<TunnelStatus>('stop_tunnel_cmd');

export const getTunnelStatus = (): Promise<TunnelStatus> =>
  isWebBrowser()
    ? httpGet<TunnelStatus>('/api/tunnel/status')
    : tauriInvoke<TunnelStatus>('get_tunnel_status');

export const testTelegramNotification = (): Promise<void> =>
  isWebBrowser()
    ? Promise.reject(new Error('Not available in browser mode'))
    : tauriInvoke<void>('test_telegram_notification');

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const getActiveJobs = (): Promise<PromptJob[]> =>
  isWebBrowser()
    ? httpGet<{ jobs: PromptJob[] }>('/api/jobs?status=active').then((r) => r.jobs ?? [])
    : tauriInvoke<PromptJob[]>('get_active_jobs');

export const getRecentJobs = (limit: number = 20): Promise<PromptJob[]> =>
  isWebBrowser()
    ? httpGet<{ jobs: PromptJob[] }>(`/api/jobs?limit=${limit}`).then((r) => r.jobs ?? [])
    : tauriInvoke<PromptJob[]>('get_recent_jobs', { limit });

export const getJob = (id: string): Promise<PromptJob | null> =>
  isWebBrowser()
    ? httpGet<PromptJob>(`/api/jobs/${id}`).catch(() => null)
    : tauriInvoke<PromptJob | null>('get_job', { id });

export const getJobsByTask = (taskId: string): Promise<PromptJob[]> =>
  isWebBrowser()
    ? httpGet<{ jobs: PromptJob[] }>('/api/jobs')
        .then((r) => (r.jobs ?? []).filter((j) => j.task_id === taskId))
    : tauriInvoke<PromptJob[]>('get_jobs_by_task', { taskId });

export const runTaskPrompt = (taskId: string, prompt?: string, provider?: string): Promise<string> =>
  isWebBrowser()
    ? httpPost<{ job_id: string }>(`/api/tasks/${taskId}/run`, { prompt, provider }).then((r) => r.job_id)
    : tauriInvoke<string>('create_and_run_job', { taskId, prompt, provider });

export const cancelPromptRun = (jobId: string): Promise<void> =>
  isWebBrowser()
    ? httpPost<void>(`/api/jobs/${jobId}/cancel`, {})
    : tauriInvoke<void>('cancel_prompt_run', { jobId });

export const updateTaskPrompt = (taskId: string, rawPrompt?: string, improvedPrompt?: string): Promise<void> =>
  isWebBrowser()
    ? httpPatch<void>(`/api/tasks/${taskId}/prompt`, { raw_prompt: rawPrompt, improved_prompt: improvedPrompt })
    : tauriInvoke<void>('save_task_prompt', { id: taskId, rawPrompt, improvedPrompt });

// ---------------------------------------------------------------------------
// Project-scoped tasks
// ---------------------------------------------------------------------------

export const getTasksByProject = (projectId: string): Promise<Task[]> =>
  isWebBrowser()
    ? httpGet<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks`).then((r) => r.tasks ?? [])
    : tauriInvoke<Task[]>('get_tasks', { projectId });

export const getStandaloneTasks = (): Promise<Task[]> =>
  isWebBrowser()
    ? httpGet<{ tasks: Task[] }>('/api/tasks/standalone').then((r) => r.tasks ?? [])
    : tauriInvoke<Task[]>('get_tasks', {}).then((tasks) => tasks.filter((t) => !t.project_id));

// ---------------------------------------------------------------------------
// Project-scoped git (browser mode delegates to HTTP; desktop uses project path)
// ---------------------------------------------------------------------------

export const getProjectGitStatus = (projectId: string): Promise<{ status: string; clean: boolean }> =>
  isWebBrowser()
    ? httpGet<{ status: string; clean: boolean }>(`/api/projects/${projectId}/git/status`)
    : tauriInvoke<{ status: string; clean: boolean }>('git_status', { projectId });

export const getProjectGitDiff = (projectId: string): Promise<{ diff: string }> =>
  isWebBrowser()
    ? httpGet<{ diff: string }>(`/api/projects/${projectId}/git/diff`)
    : tauriInvoke<{ diff: string }>('git_diff', { projectId });

export const commitProject = (projectId: string, message: string): Promise<{ success: boolean; output: string }> =>
  isWebBrowser()
    ? httpPost<{ success: boolean; output: string }>(`/api/projects/${projectId}/git/commit`, { message })
    : tauriInvoke<{ success: boolean; output: string }>('git_commit', { projectId, message });

export const pushProject = (projectId: string): Promise<{ success: boolean; output: string }> =>
  isWebBrowser()
    ? httpPost<{ success: boolean; output: string }>(`/api/projects/${projectId}/git/push`, {})
    : tauriInvoke<{ success: boolean; output: string }>('git_push', { projectId });
