import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// Reset store and mocks between every test
beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
});

// Helper: fresh store instance per test (resetModules wipes module cache)
async function getStore() {
  const { usePromptQueueStore } = await import('../stores/promptQueueStore');
  // Reset to empty state
  usePromptQueueStore.setState({ queue: [], nextQueueNumber: 1 });
  return usePromptQueueStore;
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

describe('promptQueueStore.enqueue', () => {
  it('adds a job with pending status and correct queueNumber', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();
    await store.getState().enqueue({ prompt: 'hello', provider: 'claude' });
    const { queue } = store.getState();
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe('running'); // auto-started since nothing running
    expect(queue[0].queueNumber).toBe(1);
    expect(queue[0].prompt).toBe('hello');
    expect(queue[0].logs).toEqual([]);
  });

  it('increments queueNumber on successive enqueues', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();
    await store.getState().enqueue({ prompt: 'job1', provider: 'claude' });
    await store.getState().enqueue({ prompt: 'job2', provider: 'claude' });
    const { queue } = store.getState();
    expect(queue[0].queueNumber).toBe(1);
    expect(queue[1].queueNumber).toBe(2);
  });

  it('auto-starts first job immediately (no running job)', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();
    await store.getState().enqueue({ prompt: 'first', provider: 'claude' });
    expect(store.getState().queue[0].status).toBe('running');
  });

  it('does NOT start second job if first is already running', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();
    await store.getState().enqueue({ prompt: 'job1', provider: 'claude' });
    await store.getState().enqueue({ prompt: 'job2', provider: 'claude' });
    const { queue } = store.getState();
    expect(queue[0].status).toBe('running');
    expect(queue[1].status).toBe('pending');
  });

  it('passes projectPath and provider through to the job', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();
    await store.getState().enqueue({ prompt: 'p', projectPath: '/my/app', provider: 'opencode' });
    const job = store.getState().queue[0];
    expect(job.projectPath).toBe('/my/app');
    expect(job.provider).toBe('opencode');
  });
});

// ---------------------------------------------------------------------------
// startJob
// ---------------------------------------------------------------------------

describe('promptQueueStore.startJob', () => {
  it('transitions job status to running', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();
    // Manually add a pending job without triggering auto-start
    store.setState({
      queue: [{
        id: 'j1', queueNumber: 1, prompt: 'test', provider: 'claude',
        status: 'pending', logs: [], createdAt: new Date(),
      }],
      nextQueueNumber: 2,
    });
    store.getState().startJob('j1');
    expect(store.getState().queue[0].status).toBe('running');
  });

  it('calls invoke run_prompt with correct params', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();
    store.setState({
      queue: [{
        id: 'job-42', queueNumber: 1, prompt: 'my prompt',
        projectPath: '/app', provider: 'opencode',
        status: 'pending', logs: [], createdAt: new Date(),
      }],
      nextQueueNumber: 2,
    });
    store.getState().startJob('job-42');
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('run_prompt', {
      prompt: 'my prompt',
      projectPath: '/app',
      provider: 'opencode',
      jobId: 'job-42',
    });
  });

  it('marks job as error when invoke rejects (IPC failure)', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('IPC error'));
    const store = await getStore();
    store.setState({
      queue: [{
        id: 'j-err', queueNumber: 1, prompt: 'fail', provider: 'claude',
        status: 'pending', logs: [], createdAt: new Date(),
      }],
      nextQueueNumber: 2,
    });
    store.getState().startJob('j-err');
    // Give the rejected promise microtask a tick to resolve
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().queue[0].status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// appendLog
// ---------------------------------------------------------------------------

describe('promptQueueStore.appendLog', () => {
  it('appends a log line to the correct job', async () => {
    const store = await getStore();
    store.setState({
      queue: [
        { id: 'j1', queueNumber: 1, prompt: '', status: 'running', logs: [], createdAt: new Date() },
        { id: 'j2', queueNumber: 2, prompt: '', status: 'pending', logs: [], createdAt: new Date() },
      ],
      nextQueueNumber: 3,
    });
    store.getState().appendLog('j1', 'line 1');
    store.getState().appendLog('j1', 'line 2');
    expect(store.getState().queue[0].logs).toEqual(['line 1', 'line 2']);
    expect(store.getState().queue[1].logs).toEqual([]);
  });

  it('is a no-op for unknown job id', async () => {
    const store = await getStore();
    store.setState({ queue: [], nextQueueNumber: 1 });
    expect(() => store.getState().appendLog('ghost', 'hi')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// finishJob
// ---------------------------------------------------------------------------

describe('promptQueueStore.finishJob', () => {
  it('sets status to done on success', async () => {
    const store = await getStore();
    store.setState({
      queue: [{ id: 'j1', queueNumber: 1, prompt: '', status: 'running', logs: [], createdAt: new Date() }],
      nextQueueNumber: 2,
    });
    store.getState().finishJob('j1', true);
    expect(store.getState().queue[0].status).toBe('done');
    expect(store.getState().queue[0].finishedAt).toBeInstanceOf(Date);
  });

  it('sets status to error on failure', async () => {
    const store = await getStore();
    store.setState({
      queue: [{ id: 'j1', queueNumber: 1, prompt: '', status: 'running', logs: [], createdAt: new Date() }],
      nextQueueNumber: 2,
    });
    store.getState().finishJob('j1', false);
    expect(store.getState().queue[0].status).toBe('error');
  });

  it('auto-starts next pending job after finishing current', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();
    store.setState({
      queue: [
        { id: 'j1', queueNumber: 1, prompt: 'first', provider: 'claude', status: 'running', logs: [], createdAt: new Date() },
        { id: 'j2', queueNumber: 2, prompt: 'second', provider: 'claude', status: 'pending', logs: [], createdAt: new Date() },
      ],
      nextQueueNumber: 3,
    });
    store.getState().finishJob('j1', true);
    const { queue } = store.getState();
    expect(queue[0].status).toBe('done');
    expect(queue[1].status).toBe('running');
  });

  it('does not start another job if no pending jobs remain', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();
    store.setState({
      queue: [
        { id: 'j1', queueNumber: 1, prompt: 'only', provider: 'claude', status: 'running', logs: [], createdAt: new Date() },
      ],
      nextQueueNumber: 2,
    });
    store.getState().finishJob('j1', true);
    expect(store.getState().queue[0].status).toBe('done');
    // invoke should not have been called for a second job
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// clearDone
// ---------------------------------------------------------------------------

describe('promptQueueStore.clearDone', () => {
  it('removes done and error jobs, keeps pending and running', async () => {
    const store = await getStore();
    store.setState({
      queue: [
        { id: 'j1', queueNumber: 1, prompt: '', status: 'done',    logs: [], createdAt: new Date() },
        { id: 'j2', queueNumber: 2, prompt: '', status: 'error',   logs: [], createdAt: new Date() },
        { id: 'j3', queueNumber: 3, prompt: '', status: 'running', logs: [], createdAt: new Date() },
        { id: 'j4', queueNumber: 4, prompt: '', status: 'pending', logs: [], createdAt: new Date() },
      ],
      nextQueueNumber: 5,
    });
    store.getState().clearDone();
    const ids = store.getState().queue.map((j) => j.id);
    expect(ids).toEqual(['j3', 'j4']);
  });

  it('is a no-op when no done jobs exist', async () => {
    const store = await getStore();
    store.setState({
      queue: [
        { id: 'j1', queueNumber: 1, prompt: '', status: 'running', logs: [], createdAt: new Date() },
      ],
      nextQueueNumber: 2,
    });
    store.getState().clearDone();
    expect(store.getState().queue).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Serial queue — full lifecycle
// ---------------------------------------------------------------------------

describe('promptQueueStore serial queue', () => {
  it('runs jobs one at a time in order', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();

    // Enqueue two jobs
    await store.getState().enqueue({ prompt: 'job1', provider: 'claude' });
    await store.getState().enqueue({ prompt: 'job2', provider: 'claude' });

    let queue = store.getState().queue;
    expect(queue[0].status).toBe('running');
    expect(queue[1].status).toBe('pending');

    // Simulate job1 completion via event
    store.getState().finishJob(queue[0].id, true);

    queue = store.getState().queue;
    expect(queue[0].status).toBe('done');
    expect(queue[1].status).toBe('running');

    // Simulate job2 completion
    store.getState().finishJob(queue[1].id, true);
    expect(store.getState().queue[1].status).toBe('done');
  });

  it('invoke is called once per job with correct jobId', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const store = await getStore();

    await store.getState().enqueue({ prompt: 'first', provider: 'claude' });
    const job1Id = store.getState().queue[0].id;

    store.getState().finishJob(job1Id, true);
    await store.getState().enqueue({ prompt: 'second', provider: 'claude' });
    const job2Id = store.getState().queue.find((j) => j.prompt === 'second')!.id;

    const calls = vi.mocked(invoke).mock.calls;
    const runCalls = calls.filter((c) => c[0] === 'run_prompt');
    expect(runCalls.length).toBe(2);
    expect(runCalls[0][1]).toMatchObject({ jobId: job1Id });
    expect(runCalls[1][1]).toMatchObject({ jobId: job2Id });
  });
});

describe('promptQueueStore worktree concurrency', () => {
  it('queues non-worktree job when another non-worktree job is running', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'is_git_worktree') return false;
      if (command === 'run_prompt') return undefined;
      return undefined;
    });

    const store = await getStore();
    await store.getState().enqueue({ prompt: 'main-1', projectPath: '/repo', provider: 'claude' });
    await store.getState().enqueue({ prompt: 'main-2', projectPath: '/repo', provider: 'claude' });

    const queue = store.getState().queue;
    expect(queue[0].status).toBe('running');
    expect(queue[1].status).toBe('pending');
    expect(queue[0].isWorktree).toBe(false);
    expect(queue[1].isWorktree).toBe(false);
  });

  it('starts worktree job immediately while a non-worktree job is running', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'is_git_worktree') {
        return (args as { projectPath?: string } | undefined)?.projectPath === '/tmp/wt1';
      }
      if (command === 'run_prompt') return undefined;
      return undefined;
    });

    const store = await getStore();
    await store.getState().enqueue({ prompt: 'main', projectPath: '/repo', provider: 'claude' });
    await store.getState().enqueue({ prompt: 'worktree', projectPath: '/tmp/wt1', provider: 'claude' });

    const queue = store.getState().queue;
    expect(queue[0].status).toBe('running');
    expect(queue[1].status).toBe('running');
    expect(queue[1].isWorktree).toBe(true);
  });

  it('runs two worktree jobs concurrently', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'is_git_worktree') return true;
      if (command === 'run_prompt') return undefined;
      return undefined;
    });

    const store = await getStore();
    await store.getState().enqueue({ prompt: 'wt-1', projectPath: '/tmp/wt1', provider: 'claude' });
    await store.getState().enqueue({ prompt: 'wt-2', projectPath: '/tmp/wt2', provider: 'claude' });

    const queue = store.getState().queue;
    expect(queue[0].status).toBe('running');
    expect(queue[1].status).toBe('running');
    expect(queue[0].isWorktree).toBe(true);
    expect(queue[1].isWorktree).toBe(true);
  });
});
