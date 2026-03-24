import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('taskStore basic operations', () => {
  it('createTask calls backend then refreshes tasks', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke
      .mockResolvedValueOnce('task-1')
      .mockResolvedValueOnce([]);

    const { useTaskStore } = await import('../stores/taskStore');
    const id = await useTaskStore.getState().createTask({ title: 'New task' });

    expect(id).toBe('task-1');
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'create_task', {
      input: { title: 'New task' },
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'get_tasks', {});
  });

  it('updateTaskStatus updates task locally after backend call', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue(undefined);

    const { useTaskStore } = await import('../stores/taskStore');
    useTaskStore.setState({ tasks: [{ id: 'task-1', status: 'pending', title: 'T' } as any] });

    await useTaskStore.getState().updateTaskStatus('task-1', 'done');

    expect(mockInvoke).toHaveBeenCalledWith('update_task_status', {
      id: 'task-1',
      status: 'done',
    });
    expect(useTaskStore.getState().tasks[0].status).toBe('done');
  });
});
