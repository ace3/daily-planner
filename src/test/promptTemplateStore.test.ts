import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function getStore() {
  const { usePromptTemplateStore } = await import('../stores/promptTemplateStore');
  usePromptTemplateStore.setState({
    promptTemplates: [],
    selectedTemplateId: null,
    loading: false,
    error: null,
  });
  return usePromptTemplateStore;
}

describe('promptTemplateStore', () => {
  it('fetchPromptTemplates loads template list', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { id: 't1', name: 'Bugfix', content: 'Fix the bug in {{file}}.' },
    ]);

    const store = await getStore();
    await store.getState().fetchPromptTemplates();

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_prompt_templates', {});
    expect(store.getState().promptTemplates).toEqual([
      { id: 't1', name: 'Bugfix', content: 'Fix the bug in {{file}}.' },
    ]);
  });

  it('selectTemplate updates selectedTemplateId', async () => {
    const store = await getStore();
    store.getState().selectTemplate('t1');
    expect(store.getState().selectedTemplateId).toBe('t1');
    store.getState().selectTemplate(null);
    expect(store.getState().selectedTemplateId).toBeNull();
  });

  it('createTemplate adds template and selects it', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: 't2',
      name: 'Plan',
      content: 'Plan this task carefully.',
    });

    const store = await getStore();
    const created = await store.getState().createTemplate('Plan', 'Plan this task carefully.');

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('create_prompt_template', {
      name: 'Plan',
      content: 'Plan this task carefully.',
    });
    expect(created.id).toBe('t2');
    expect(store.getState().promptTemplates[0].id).toBe('t2');
    expect(store.getState().selectedTemplateId).toBe('t2');
  });

  it('updateTemplate updates existing item', async () => {
    const store = await getStore();
    store.setState({
      promptTemplates: [{ id: 't1', name: 'Old', content: 'old content' }],
      selectedTemplateId: null,
      loading: false,
      error: null,
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      id: 't1',
      name: 'New',
      content: 'new content',
    });

    await store.getState().updateTemplate('t1', 'New', 'new content');

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('update_prompt_template', {
      id: 't1',
      name: 'New',
      content: 'new content',
    });
    expect(store.getState().promptTemplates).toEqual([
      { id: 't1', name: 'New', content: 'new content' },
    ]);
    expect(store.getState().selectedTemplateId).toBe('t1');
  });

  it('deleteTemplate removes an existing item and clears selection', async () => {
    const store = await getStore();
    store.setState({
      promptTemplates: [
        { id: 't1', name: 'A', content: 'a' },
        { id: 't2', name: 'B', content: 'b' },
      ],
      selectedTemplateId: 't1',
      loading: false,
      error: null,
    });
    vi.mocked(invoke).mockResolvedValueOnce(true);

    const deleted = await store.getState().deleteTemplate('t1');

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('delete_prompt_template', { id: 't1' });
    expect(deleted).toBe(true);
    expect(store.getState().promptTemplates).toEqual([{ id: 't2', name: 'B', content: 'b' }]);
    expect(store.getState().selectedTemplateId).toBeNull();
  });
});
