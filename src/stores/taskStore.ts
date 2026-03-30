import { create } from 'zustand';
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  RunTaskWorktreeResult,
  CleanupTaskWorktreeResult,
} from '../types/task';
import * as api from '../lib/tauri';

interface TaskState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  fetchTasks: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<string>;
  updateTask: (input: UpdateTaskInput) => Promise<void>;
  updateTaskStatus: (id: string, status: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  carryTaskForward: (id: string, tomorrowDate: string) => Promise<void>;
  reorderTasks: (taskIds: string[]) => Promise<void>;
  savePromptResult: (id: string, rawPrompt: string, improvedPrompt: string) => Promise<void>;
  runTaskAsWorktree: (id: string) => Promise<RunTaskWorktreeResult>;
  cleanupTaskWorktree: (id: string) => Promise<CleanupTaskWorktreeResult>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await api.getTasks();
      set({ tasks, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createTask: async (input) => {
    const id = await api.createTask(input);
    await get().fetchTasks();
    return id;
  },

  updateTask: async (input) => {
    await api.updateTask(input);
    await get().fetchTasks();
  },

  updateTaskStatus: async (id, status) => {
    await api.updateTaskStatus(id, status);
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, status: status as Task['status'] } : t
      ),
    }));
  },

  deleteTask: async (id) => {
    await api.deleteTask(id);
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
  },

  carryTaskForward: async (id, tomorrowDate) => {
    await api.carryTaskForward(id, tomorrowDate);
    await get().fetchTasks();
  },

  reorderTasks: async (taskIds) => {
    await api.reorderTasks(taskIds);
    await get().fetchTasks();
  },

  savePromptResult: async (id, rawPrompt, improvedPrompt) => {
    await api.savePromptResult(id, rawPrompt, improvedPrompt);
    await get().fetchTasks();
  },

  runTaskAsWorktree: async (id) => {
    const result = await api.runTaskAsWorktree(id);
    await get().fetchTasks();
    return result;
  },

  cleanupTaskWorktree: async (id) => {
    const result = await api.cleanupTaskWorktree(id);
    await get().fetchTasks();
    return result;
  },
}));
