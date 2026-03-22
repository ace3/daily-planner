import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('taskStore worktree actions', () => {
  it('runTaskAsWorktree calls backend and refreshes tasks', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke
      .mockResolvedValueOnce({
        task_id: 'task-1',
        worktree_path: '/tmp/daily-planner-worktrees/task-1',
        branch_name: 'task/test-task-12345678',
        status: 'active',
        launch_command: "cd '/tmp/daily-planner-worktrees/task-1' && claude --worktree -p 'prompt'",
        prompt_to_run: 'prompt',
      })
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce([]);

    const { useTaskStore } = await import('../stores/taskStore');
    useTaskStore.setState({ activeDate: '2026-03-22', tasks: [] });

    const result = await useTaskStore.getState().runTaskAsWorktree('task-1');

    expect(result.branch_name).toBe('task/test-task-12345678');
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'run_task_as_worktree', { taskId: 'task-1' });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'rollover_incomplete_tasks', { date: '2026-03-22' });
    expect(mockInvoke).toHaveBeenNthCalledWith(3, 'get_tasks', { date: '2026-03-22' });
  });

  it('cleanupTaskWorktree calls backend and refreshes tasks', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke
      .mockResolvedValueOnce({
        task_id: 'task-1',
        worktree_path: '/tmp/daily-planner-worktrees/task-1',
        branch_name: 'task/test-task-12345678',
        status: 'abandoned',
        branch_deleted: false,
        warning: "Worktree removed. Branch 'task/test-task-12345678' has unmerged changes and was kept.",
      })
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce([]);

    const { useTaskStore } = await import('../stores/taskStore');
    useTaskStore.setState({ activeDate: '2026-03-22', tasks: [] });

    const result = await useTaskStore.getState().cleanupTaskWorktree('task-1');

    expect(result.status).toBe('abandoned');
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'cleanup_task_worktree', { taskId: 'task-1' });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'rollover_incomplete_tasks', { date: '2026-03-22' });
    expect(mockInvoke).toHaveBeenNthCalledWith(3, 'get_tasks', { date: '2026-03-22' });
  });
});
