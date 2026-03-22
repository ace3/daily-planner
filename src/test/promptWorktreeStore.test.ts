import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function getStore() {
  const { usePromptQueueStore } = await import('../stores/promptQueueStore');
  usePromptQueueStore.setState({ queue: [], nextQueueNumber: 1 });
  return usePromptQueueStore;
}

function pendingJobWithProject(id = 'job-1', projectPath = '/my/repo') {
  return {
    id,
    queueNumber: 1,
    prompt: 'do something',
    projectPath,
    originalProjectPath: projectPath,
    provider: 'claude' as const,
    isWorktree: false,
    status: 'pending' as const,
    improveStep: 'done' as const,
    runStep: 'waiting' as const,
    logs: [],
    createdAt: new Date(),
    worktreeStatus: 'none' as const,
    testOutput: [],
  };
}

function doneJobWithWorktree(id = 'job-1', projectPath = '/my/repo') {
  return {
    ...pendingJobWithProject(id, projectPath),
    status: 'done' as const,
    runStep: 'done' as const,
    worktreeStatus: 'ready' as const,
    worktreePath: '/tmp/daily-planner-prompt-worktrees/job-1',
    worktreeBranch: 'prompt/job-1abc-1700000000',
  };
}

// ---------------------------------------------------------------------------
// createWorktreeForJob
// ---------------------------------------------------------------------------

describe('promptQueueStore.createWorktreeForJob', () => {
  it('sets worktreeStatus to creating then ready on success', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'create_prompt_worktree') {
        return { worktree_path: '/tmp/wt/job-1', branch_name: 'prompt/job1-1700000' };
      }
      if (command === 'is_git_worktree') return true;
      if (command === 'run_prompt') return undefined;
      return undefined;
    });

    const store = await getStore();
    store.setState({ queue: [pendingJobWithProject()], nextQueueNumber: 2 });

    const createPromise = store.getState().createWorktreeForJob('job-1');
    // After async call resolves
    await createPromise;

    const job = store.getState().queue.find((j) => j.id === 'job-1')!;
    expect(job.worktreeStatus).toBe('ready');
    expect(job.worktreePath).toBe('/tmp/wt/job-1');
    expect(job.worktreeBranch).toBe('prompt/job1-1700000');
    expect(job.projectPath).toBe('/tmp/wt/job-1');
    expect(job.isWorktree).toBe(true);
  });

  it('resets worktreeStatus to none on failure', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'create_prompt_worktree') throw new Error('git error');
      return undefined;
    });

    const store = await getStore();
    store.setState({ queue: [pendingJobWithProject()], nextQueueNumber: 2 });

    await store.getState().createWorktreeForJob('job-1');

    const job = store.getState().queue.find((j) => j.id === 'job-1')!;
    expect(job.worktreeStatus).toBe('none');
  });

  it('is a no-op if job has no originalProjectPath', async () => {
    const store = await getStore();
    store.setState({
      queue: [{
        ...pendingJobWithProject('job-x'),
        originalProjectPath: undefined,
      }],
      nextQueueNumber: 2,
    });

    await store.getState().createWorktreeForJob('job-x');
    const job = store.getState().queue[0];
    expect(job.worktreeStatus).toBe('none');
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('create_prompt_worktree', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// runTestsForJob
// ---------------------------------------------------------------------------

describe('promptQueueStore.runTestsForJob', () => {
  it('sets tests_passed when result.passed is true', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'run_tests_in_worktree') {
        return { passed: true, frontend_passed: 84, frontend_failed: 0, rust_passed: 53, rust_failed: 0 };
      }
      return undefined;
    });

    const store = await getStore();
    store.setState({ queue: [doneJobWithWorktree()], nextQueueNumber: 2 });

    await store.getState().runTestsForJob('job-1');

    const job = store.getState().queue[0];
    expect(job.worktreeStatus).toBe('tests_passed');
    expect(job.testResults?.frontend_passed).toBe(84);
    expect(job.testResults?.rust_passed).toBe(53);
  });

  it('sets tests_failed when result.passed is false', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'run_tests_in_worktree') {
        return { passed: false, frontend_passed: 80, frontend_failed: 4, rust_passed: 53, rust_failed: 0 };
      }
      return undefined;
    });

    const store = await getStore();
    store.setState({ queue: [doneJobWithWorktree()], nextQueueNumber: 2 });

    await store.getState().runTestsForJob('job-1');

    const job = store.getState().queue[0];
    expect(job.worktreeStatus).toBe('tests_failed');
    expect(job.testResults?.frontend_failed).toBe(4);
  });

  it('sets tests_running while waiting, then updates on completion', async () => {
    let resolveTests!: (v: unknown) => void;
    const testPromise = new Promise((r) => { resolveTests = r; });

    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'run_tests_in_worktree') return testPromise;
      return undefined;
    });

    const store = await getStore();
    store.setState({ queue: [doneJobWithWorktree()], nextQueueNumber: 2 });

    const runPromise = store.getState().runTestsForJob('job-1');
    // Check intermediate state
    expect(store.getState().queue[0].worktreeStatus).toBe('tests_running');

    resolveTests({ passed: true, frontend_passed: 84, frontend_failed: 0, rust_passed: 53, rust_failed: 0 });
    await runPromise;
    expect(store.getState().queue[0].worktreeStatus).toBe('tests_passed');
  });

  it('is a no-op if job has no worktreePath', async () => {
    const store = await getStore();
    store.setState({
      queue: [{
        ...pendingJobWithProject(),
        status: 'done' as const,
        runStep: 'done' as const,
        worktreeStatus: 'none' as const,
        testOutput: [],
      }],
      nextQueueNumber: 2,
    });

    await store.getState().runTestsForJob('job-1');
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('run_tests_in_worktree', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// mergeWorktreeForJob
// ---------------------------------------------------------------------------

describe('promptQueueStore.mergeWorktreeForJob', () => {
  it('sets merged on successful merge', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'merge_worktree_branch') return { success: true, message: 'merged' };
      if (command === 'cleanup_prompt_worktree') return { success: true, message: 'cleaned' };
      return undefined;
    });

    const store = await getStore();
    store.setState({
      queue: [{
        ...doneJobWithWorktree(),
        worktreeStatus: 'tests_passed' as const,
      }],
      nextQueueNumber: 2,
    });

    await store.getState().mergeWorktreeForJob('job-1', 'main');

    expect(mockInvoke).toHaveBeenCalledWith('merge_worktree_branch', {
      projectPath: '/my/repo',
      branchName: 'prompt/job-1abc-1700000000',
      targetBranch: 'main',
    });
    expect(store.getState().queue[0].worktreeStatus).toBe('merged');
  });

  it('reverts to tests_passed on merge failure', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'merge_worktree_branch') return { success: false, message: 'conflict' };
      return undefined;
    });

    const store = await getStore();
    store.setState({
      queue: [{
        ...doneJobWithWorktree(),
        worktreeStatus: 'tests_passed' as const,
      }],
      nextQueueNumber: 2,
    });

    await store.getState().mergeWorktreeForJob('job-1', 'main');
    expect(store.getState().queue[0].worktreeStatus).toBe('tests_passed');
  });
});
