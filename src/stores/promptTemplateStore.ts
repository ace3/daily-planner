import { create } from 'zustand';
import type { PromptTemplate } from '../types/task';
import * as api from '../lib/tauri';

interface PromptTemplateState {
  promptTemplates: PromptTemplate[];
  selectedTemplateId: string | null;
  loading: boolean;
  error: string | null;
  fetchPromptTemplates: () => Promise<void>;
  selectTemplate: (id: string | null) => void;
  createTemplate: (name: string, content: string) => Promise<PromptTemplate>;
  updateTemplate: (id: string, name: string, content: string) => Promise<PromptTemplate>;
  deleteTemplate: (id: string) => Promise<boolean>;
}

export const usePromptTemplateStore = create<PromptTemplateState>((set, get) => ({
  promptTemplates: [],
  selectedTemplateId: null,
  loading: false,
  error: null,

  fetchPromptTemplates: async () => {
    set({ loading: true, error: null });
    try {
      const promptTemplates = await api.getPromptTemplates();
      set({ promptTemplates, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  selectTemplate: (id) => set({ selectedTemplateId: id }),

  createTemplate: async (name, content) => {
    const created = await api.createPromptTemplate(name, content);
    set((state) => ({
      promptTemplates: [created, ...state.promptTemplates],
      selectedTemplateId: created.id,
      error: null,
    }));
    return created;
  },

  updateTemplate: async (id, name, content) => {
    const updated = await api.updatePromptTemplate(id, name, content);
    set((state) => ({
      promptTemplates: state.promptTemplates.map((t) => (t.id === id ? updated : t)),
      selectedTemplateId: updated.id,
      error: null,
    }));
    return updated;
  },

  deleteTemplate: async (id) => {
    const deleted = await api.deletePromptTemplate(id);
    if (!deleted) return false;

    const nextSelectedId = get().selectedTemplateId === id ? null : get().selectedTemplateId;
    set((state) => ({
      promptTemplates: state.promptTemplates.filter((t) => t.id !== id),
      selectedTemplateId: nextSelectedId,
      error: null,
    }));
    return true;
  },
}));
