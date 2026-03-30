import { create } from 'zustand';
import type { Project, CreateProjectInput } from '../types/project';
import * as api from '../lib/tauri';

const SELECTED_PROJECT_KEY = 'selected_project_id';

interface ProjectState {
  projects: Project[];
  trashedProjects: Project[];
  selectedProject: Project | null;
  loading: boolean;
  projectPrompt: string | null;
  fetchProjects: () => Promise<void>;
  fetchTrashedProjects: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<string>;
  deleteProject: (id: string) => Promise<void>;
  restoreProject: (id: string) => Promise<void>;
  hardDeleteProject: (id: string) => Promise<void>;
  setSelectedProject: (project: Project | null) => void;
  /** Call once at app bootstrap after fetchProjects to rehydrate selection. */
  initSelectedProject: () => Promise<void>;
  fetchProjectPrompt: (projectId: string) => Promise<void>;
  setProjectPrompt: (projectId: string, prompt: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  trashedProjects: [],
  selectedProject: null,
  loading: false,
  projectPrompt: null,

  fetchProjects: async () => {
    set({ loading: true });
    try {
      const projects = await api.getProjects();
      set({ projects: Array.isArray(projects) ? projects : [], loading: false });
    } catch {
      set({ projects: [], loading: false });
    }
  },

  fetchTrashedProjects: async () => {
    try {
      const trashedProjects = await api.getTrashedProjects();
      set({ trashedProjects });
    } catch {
      set({ trashedProjects: [] });
    }
  },

  createProject: async (input) => {
    const id = await api.createProject(input);
    await Promise.all([get().fetchProjects(), get().fetchTrashedProjects()]);
    return id;
  },

  deleteProject: async (id) => {
    await api.deleteProject(id);
    // Clear selection if the deleted project was selected
    if (get().selectedProject?.id === id) {
      set({ selectedProject: null });
      api.setSetting(SELECTED_PROJECT_KEY, '').catch(() => {});
    }
    await Promise.all([get().fetchProjects(), get().fetchTrashedProjects()]);
  },

  restoreProject: async (id) => {
    await api.restoreProject(id);
    await Promise.all([get().fetchProjects(), get().fetchTrashedProjects()]);
  },

  hardDeleteProject: async (id) => {
    await api.hardDeleteProject(id);
    if (get().selectedProject?.id === id) {
      set({ selectedProject: null });
      api.setSetting(SELECTED_PROJECT_KEY, '').catch(() => {});
    }
    await Promise.all([get().fetchProjects(), get().fetchTrashedProjects()]);
  },

  setSelectedProject: (project) => {
    set({ selectedProject: project });
    api.setSetting(SELECTED_PROJECT_KEY, project?.id ?? '').catch(() => {});
  },

  initSelectedProject: async () => {
    try {
      const savedId = await api.getSetting(SELECTED_PROJECT_KEY);
      if (!savedId) return;
      const match = get().projects.find((p) => p.id === savedId) ?? null;
      set({ selectedProject: match });
    } catch {
      // Missing setting is fine — stay with no selection
    }
  },

  fetchProjectPrompt: async (projectId) => {
    try {
      const prompt = await api.getProjectPrompt(projectId);
      set({ projectPrompt: prompt });
    } catch {
      set({ projectPrompt: null });
    }
  },

  setProjectPrompt: async (projectId, prompt) => {
    await api.setProjectPrompt(projectId, prompt);
    set({ projectPrompt: prompt || null });
    // Also update the local project list
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === projectId ? { ...p, prompt: prompt || null } : p
      ),
    }));
  },
}));
