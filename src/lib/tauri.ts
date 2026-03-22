import { invoke } from '@tauri-apps/api/core';
import type { Task, CreateTaskInput, UpdateTaskInput, PromptTemplate } from '../types/task';
import type { AppSettings } from '../types/settings';
import type { DailyReport } from '../types/report';

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

// Focus sessions
export const startFocusSession = (taskId: string, date: string) =>
  invoke<string>('start_focus_session', { taskId, date });
export const endFocusSession = (sessionId: string, notes: string) =>
  invoke<number>('end_focus_session', { sessionId, notes });

// Templates
export const getPromptTemplates = () => invoke<PromptTemplate[]>('get_prompt_templates', {});

// Settings
export const getSettings = () => invoke<AppSettings>('get_settings', {});
export const setSetting = (key: string, value: string) => invoke<void>('set_setting', { key, value });
export const saveClaudeToken = (token: string) => invoke<void>('save_claude_token', { token });
export const getClaudeToken = () => invoke<string>('get_claude_token', {});
export const detectClaudeToken = () => invoke<string>('detect_claude_token', {});

// Claude
export const sendPrompt = (prompt: string, model: string | null, streamEvent: string) =>
  invoke<string>('send_prompt', { input: { prompt, model, streamEvent } });

// Reports
export const generateReport = (date: string) => invoke<DailyReport>('generate_report', { date });
export const getReport = (date: string) => invoke<DailyReport | null>('get_report', { date });
export const getReportsRange = (from: string, to: string) => invoke<DailyReport[]>('get_reports_range', { from, to });
export const saveAiReflection = (date: string, reflection: string) =>
  invoke<void>('save_ai_reflection', { date, reflection });
