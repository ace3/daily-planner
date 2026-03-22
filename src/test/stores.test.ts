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
