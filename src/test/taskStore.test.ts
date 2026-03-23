import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function getStore() {
  const { useTaskStore } = await import('../stores/taskStore');
  useTaskStore.setState({ tasks: [], loading: false, error: null, activeDate: '2026-03-23' });
  return useTaskStore;
}

// ---------------------------------------------------------------------------
// moveTaskToSession
// ---------------------------------------------------------------------------

describe('taskStore.moveTaskToSession', () => {
  it('calls move_task_to_session with correct params and updates task slot optimistically', async () => {
    const mockTask = {
      id: 'task-1',
      session_slot: 1,
      title: 'Test',
      status: 'pending',
      task_type: 'other',
      priority: 2,
      date: '2026-03-23',
      notes: '',
      estimated_min: null,
      actual_min: null,
      prompt_used: null,
      prompt_result: null,
      carried_from: null,
      position: 0,
      created_at: '2026-03-23T00:00:00Z',
      updated_at: '2026-03-23T00:00:00Z',
      completed_at: null,
      project_id: null,
      worktree_path: null,
      worktree_branch: null,
      worktree_status: null,
    };

    vi.mocked(invoke).mockResolvedValue(undefined);

    const store = await getStore();
    store.setState({ tasks: [mockTask], activeDate: '2026-03-23' });

    await store.getState().moveTaskToSession('task-1', 2);

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('move_task_to_session', {
      taskId: 'task-1',
      targetSession: 2,
    });

    // Optimistic update: session_slot should be 2 immediately
    const updated = store.getState().tasks.find((t) => t.id === 'task-1');
    expect(updated?.session_slot).toBe(2);
  });

  it('moves a task from session 2 back to session 1', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    const store = await getStore();
    store.setState({
      tasks: [{ id: 'task-2', session_slot: 2 } as any],
      activeDate: '2026-03-23',
    });

    await store.getState().moveTaskToSession('task-2', 1);

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('move_task_to_session', {
      taskId: 'task-2',
      targetSession: 1,
    });
    expect(store.getState().tasks[0].session_slot).toBe(1);
  });
});
