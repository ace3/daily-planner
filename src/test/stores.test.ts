import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

describe('settingsStore defaults', () => {
  it('has default timezone offset of 7', async () => {
    const { useSettingsStore } = await import('../stores/settingsStore');
    const store = useSettingsStore.getState();
    expect(store.settings?.timezone_offset).toBe(7);
  });

  it('has default session times', async () => {
    const { useSettingsStore } = await import('../stores/settingsStore');
    const store = useSettingsStore.getState();
    expect(store.settings?.session1_kickstart).toBe('09:00');
    expect(store.settings?.planning_end).toBe('11:00');
    expect(store.settings?.session2_start).toBe('14:00');
  });

  it('has default theme of dark', async () => {
    const { useSettingsStore } = await import('../stores/settingsStore');
    const store = useSettingsStore.getState();
    expect(store.settings?.theme).toBe('dark');
  });

  it('has null globalPrompt by default', async () => {
    const { useSettingsStore } = await import('../stores/settingsStore');
    const store = useSettingsStore.getState();
    expect(store.globalPrompt).toBeNull();
  });
});

describe('settingsStore setTheme', () => {
  it('setTheme calls set_setting and refreshes settings', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue({ theme: 'light', timezone_offset: 7, session1_kickstart: '09:00', planning_end: '11:00', session2_start: '14:00', warn_before_min: 15, autostart: false, claude_model: 'claude-sonnet-4-6', work_days: [1,2,3,4,5], show_in_tray: true, pomodoro_work_min: 25, pomodoro_break_min: 5 });
    const { useSettingsStore } = await import('../stores/settingsStore');
    await useSettingsStore.getState().setTheme('light');
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'theme', value: 'light' });
    expect(mockInvoke).toHaveBeenCalledWith('get_settings', {});
  });

  it('setTheme to dark calls set_setting with dark', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue({ theme: 'dark', timezone_offset: 7, session1_kickstart: '09:00', planning_end: '11:00', session2_start: '14:00', warn_before_min: 15, autostart: false, claude_model: 'claude-sonnet-4-6', work_days: [1,2,3,4,5], show_in_tray: true, pomodoro_work_min: 25, pomodoro_break_min: 5 });
    const { useSettingsStore } = await import('../stores/settingsStore');
    await useSettingsStore.getState().setTheme('dark');
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'theme', value: 'dark' });
  });
});

describe('settingsStore globalPrompt', () => {
  it('fetchGlobalPrompt calls get_global_prompt', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue('You are a helpful assistant.');
    const { useSettingsStore } = await import('../stores/settingsStore');
    await useSettingsStore.getState().fetchGlobalPrompt();
    expect(mockInvoke).toHaveBeenCalledWith('get_global_prompt', {});
    expect(useSettingsStore.getState().globalPrompt).toBe('You are a helpful assistant.');
  });

  it('fetchGlobalPrompt stores null for empty response', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue(null);
    const { useSettingsStore } = await import('../stores/settingsStore');
    await useSettingsStore.getState().fetchGlobalPrompt();
    expect(useSettingsStore.getState().globalPrompt).toBeNull();
  });

  it('setGlobalPrompt calls set_global_prompt and updates state', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue(undefined);
    const { useSettingsStore } = await import('../stores/settingsStore');
    await useSettingsStore.getState().setGlobalPrompt('My global prompt');
    expect(mockInvoke).toHaveBeenCalledWith('set_global_prompt', { prompt: 'My global prompt' });
    expect(useSettingsStore.getState().globalPrompt).toBe('My global prompt');
  });

  it('setGlobalPrompt with empty string stores null', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue(undefined);
    const { useSettingsStore } = await import('../stores/settingsStore');
    await useSettingsStore.getState().setGlobalPrompt('');
    expect(useSettingsStore.getState().globalPrompt).toBeNull();
  });
});

describe('taskStore operations', () => {
  it('initializes with empty tasks', async () => {
    const { useTaskStore } = await import('../stores/taskStore');
    const store = useTaskStore.getState();
    expect(store.tasks).toEqual([]);
    expect(store.loading).toBe(false);
  });

  it('fetchTasks calls invoke with correct params', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue([]);
    const { useTaskStore } = await import('../stores/taskStore');
    await useTaskStore.getState().fetchTasks('2026-03-22');
    expect(mockInvoke).toHaveBeenCalledWith('get_tasks', { date: '2026-03-22' });
  });

  it('getTasksBySlot filters correctly', async () => {
    const { useTaskStore } = await import('../stores/taskStore');
    // Set tasks directly on the store
    useTaskStore.setState({
      tasks: [
        { id: '1', session_slot: 1, status: 'pending', title: 'Task 1' } as any,
        { id: '2', session_slot: 2, status: 'pending', title: 'Task 2' } as any,
        { id: '3', session_slot: 1, status: 'done', title: 'Task 3' } as any,
      ],
    });
    const slot1 = useTaskStore.getState().getTasksBySlot(1);
    expect(slot1).toHaveLength(2);
    const slot2 = useTaskStore.getState().getTasksBySlot(2);
    expect(slot2).toHaveLength(1);
  });
});

describe('taskStore project assignment', () => {
  it('updateTask with project_id sends correct invoke payload', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue([]);
    const { useTaskStore } = await import('../stores/taskStore');
    useTaskStore.setState({ activeDate: '2026-03-22', tasks: [] });
    await useTaskStore.getState().updateTask({ id: 'task-1', project_id: 'proj-abc' });
    expect(mockInvoke).toHaveBeenCalledWith('update_task', {
      input: { id: 'task-1', project_id: 'proj-abc' },
    });
  });

  it('updateTask with clear_project sends correct invoke payload', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue([]);
    const { useTaskStore } = await import('../stores/taskStore');
    useTaskStore.setState({ activeDate: '2026-03-22', tasks: [] });
    await useTaskStore.getState().updateTask({ id: 'task-1', clear_project: true });
    expect(mockInvoke).toHaveBeenCalledWith('update_task', {
      input: { id: 'task-1', clear_project: true },
    });
  });

  it('createTask with project_id passes it through to invoke', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce('new-task-id').mockResolvedValue([]);
    const { useTaskStore } = await import('../stores/taskStore');
    useTaskStore.setState({ activeDate: '2026-03-22', tasks: [] });
    await useTaskStore.getState().createTask({
      date: '2026-03-22',
      session_slot: 1,
      title: 'Test task with project',
      project_id: 'proj-abc',
    });
    expect(mockInvoke).toHaveBeenCalledWith('create_task', {
      input: expect.objectContaining({ project_id: 'proj-abc' }),
    });
  });

  it('createTask without project_id omits the field', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce('new-task-id').mockResolvedValue([]);
    const { useTaskStore } = await import('../stores/taskStore');
    useTaskStore.setState({ activeDate: '2026-03-22', tasks: [] });
    await useTaskStore.getState().createTask({
      date: '2026-03-22',
      session_slot: 1,
      title: 'Task without project',
    });
    expect(mockInvoke).toHaveBeenCalledWith('create_task', {
      input: expect.not.objectContaining({ project_id: expect.anything() }),
    });
  });
});

describe('providerStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('defaults to claude provider', async () => {
    const { useProviderStore } = await import('../stores/providerStore');
    const store = useProviderStore.getState();
    expect(store.activeProvider).toBe('claude');
  });

  it('restores provider from localStorage', async () => {
    localStorage.setItem('active_provider', 'codex');
    const { useProviderStore } = await import('../stores/providerStore');
    const store = useProviderStore.getState();
    expect(store.activeProvider).toBe('codex');
  });

  it('setActiveProvider persists to localStorage', async () => {
    const { useProviderStore } = await import('../stores/providerStore');
    useProviderStore.getState().setActiveProvider('codex');
    expect(localStorage.getItem('active_provider')).toBe('codex');
    expect(useProviderStore.getState().activeProvider).toBe('codex');
  });

  it('checkAvailability updates claudeAvailable/codexAvailable from invoke', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue({ claude_available: true, codex_available: false });
    const { useProviderStore } = await import('../stores/providerStore');
    await useProviderStore.getState().checkAvailability();
    expect(useProviderStore.getState().claudeAvailable).toBe(true);
    expect(useProviderStore.getState().codexAvailable).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('check_cli_availability', {});
  });

  it('checkAvailability handles both CLIs available', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue({ claude_available: true, codex_available: true });
    const { useProviderStore } = await import('../stores/providerStore');
    await useProviderStore.getState().checkAvailability();
    expect(useProviderStore.getState().claudeAvailable).toBe(true);
    expect(useProviderStore.getState().codexAvailable).toBe(true);
  });

  it('checkAvailability sets both false on invoke error', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockRejectedValue(new Error('command failed'));
    const { useProviderStore } = await import('../stores/providerStore');
    await useProviderStore.getState().checkAvailability();
    expect(useProviderStore.getState().claudeAvailable).toBe(false);
    expect(useProviderStore.getState().codexAvailable).toBe(false);
  });
});

describe('projectStore', () => {
  it('initializes with empty projects', async () => {
    const { useProjectStore } = await import('../stores/projectStore');
    const store = useProjectStore.getState();
    expect(store.projects).toEqual([]);
    expect(store.loading).toBe(false);
  });

  it('has null projectPrompt by default', async () => {
    const { useProjectStore } = await import('../stores/projectStore');
    const store = useProjectStore.getState();
    expect(store.projectPrompt).toBeNull();
  });

  it('fetchProjects calls invoke with get_projects', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue([]);
    const { useProjectStore } = await import('../stores/projectStore');
    await useProjectStore.getState().fetchProjects();
    expect(mockInvoke).toHaveBeenCalledWith('get_projects', {});
  });

  it('createProject calls invoke and refreshes list', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce('proj-id').mockResolvedValue([]);
    const { useProjectStore } = await import('../stores/projectStore');
    const id = await useProjectStore.getState().createProject({ name: 'My App', path: '/path/to/app' });
    expect(id).toBe('proj-id');
    expect(mockInvoke).toHaveBeenCalledWith('create_project', {
      input: { name: 'My App', path: '/path/to/app' },
    });
  });

  it('deleteProject removes item from local store', async () => {
    const { useProjectStore } = await import('../stores/projectStore');
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'App', path: '/app', prompt: null, created_at: '' }],
    });
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue(undefined);
    await useProjectStore.getState().deleteProject('p1');
    expect(useProjectStore.getState().projects).toHaveLength(0);
    expect(mockInvoke).toHaveBeenCalledWith('delete_project', { id: 'p1' });
  });

  it('fetchProjectPrompt calls get_project_prompt and updates state', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue('This is a React project.');
    const { useProjectStore } = await import('../stores/projectStore');
    await useProjectStore.getState().fetchProjectPrompt('proj-1');
    expect(mockInvoke).toHaveBeenCalledWith('get_project_prompt', { id: 'proj-1' });
    expect(useProjectStore.getState().projectPrompt).toBe('This is a React project.');
  });

  it('setProjectPrompt calls set_project_prompt and updates state', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue(undefined);
    const { useProjectStore } = await import('../stores/projectStore');
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'App', path: '/app', prompt: null, created_at: '' }],
    });
    await useProjectStore.getState().setProjectPrompt('p1', 'New prompt');
    expect(mockInvoke).toHaveBeenCalledWith('set_project_prompt', { id: 'p1', prompt: 'New prompt' });
    expect(useProjectStore.getState().projectPrompt).toBe('New prompt');
    expect(useProjectStore.getState().projects[0].prompt).toBe('New prompt');
  });

  it('setProjectPrompt with empty string stores null in state', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue(undefined);
    const { useProjectStore } = await import('../stores/projectStore');
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'App', path: '/app', prompt: 'old', created_at: '' }],
    });
    await useProjectStore.getState().setProjectPrompt('p1', '');
    expect(useProjectStore.getState().projectPrompt).toBeNull();
  });
});
