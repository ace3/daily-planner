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
  activeDate: string;
  setActiveDate: (date: string) => void;
  fetchTasks: (date: string) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<string>;
  updateTask: (input: UpdateTaskInput) => Promise<void>;
  updateTaskStatus: (id: string, status: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  carryTaskForward: (id: string, tomorrowDate: string, sessionSlot: number) => Promise<void>;
  reorderTasks: (taskIds: string[]) => Promise<void>;
  savePromptResult: (id: string, promptUsed: string, promptResult: string) => Promise<void>;
  runTaskAsWorktree: (id: string) => Promise<RunTaskWorktreeResult>;
  cleanupTaskWorktree: (id: string) => Promise<CleanupTaskWorktreeResult>;
  getTasksBySlot: (slot: number) => Task[];
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  activeDate: '',

  setActiveDate: (date) => set({ activeDate: date }),

  fetchTasks: async (date) => {
    set({ loading: true, error: null });
    try {
      const tasks = await api.getTasks(date);
      set({ tasks, loading: false, activeDate: date });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createTask: async (input) => {
    const id = await api.createTask(input);
    await get().fetchTasks(get().activeDate);
    return id;
  },

  updateTask: async (input) => {
    await api.updateTask(input);
    await get().fetchTasks(get().activeDate);
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

  carryTaskForward: async (id, tomorrowDate, sessionSlot) => {
    await api.carryTaskForward(id, tomorrowDate, sessionSlot);
    await get().fetchTasks(get().activeDate);
  },

  reorderTasks: async (taskIds) => {
    await api.reorderTasks(taskIds);
    await get().fetchTasks(get().activeDate);
  },

  savePromptResult: async (id, promptUsed, promptResult) => {
    await api.savePromptResult(id, promptUsed, promptResult);
    await get().fetchTasks(get().activeDate);
  },

  runTaskAsWorktree: async (id) => {
    const result = await api.runTaskAsWorktree(id);
    await get().fetchTasks(get().activeDate);
    return result;
  },

  cleanupTaskWorktree: async (id) => {
    const result = await api.cleanupTaskWorktree(id);
    await get().fetchTasks(get().activeDate);
    return result;
  },

  getTasksBySlot: (slot) => {
    const { tasks } = get();
    return tasks.filter((t) => t.session_slot === slot);
  },
}));
