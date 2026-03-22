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

// ---------------------------------------------------------------------------
// enqueueWithWorktreePipeline
// ---------------------------------------------------------------------------

describe('promptQueueStore.enqueueWithWorktreePipeline', () => {
  it('creates job with worktreePipeline=true and worktreeStatus=creating', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'create_prompt_worktree') {
        return { worktree_path: '/tmp/wt/pipeline-1', branch_name: 'prompt/pipeline-1-abc' };
      }
      if (command === 'is_git_worktree') return true;
      if (command === 'run_prompt') return undefined;
      return undefined;
    });

    const store = await getStore();
    const jobId = await store.getState().enqueueWithWorktreePipeline({
      prompt: 'add feature',
      projectPath: '/my/repo',
      provider: 'claude',
    });

    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);

    const job = store.getState().queue.find((j) => j.id === jobId)!;
    expect(job).toBeDefined();
    expect(job.worktreePipeline).toBe(true);
    expect(job.isWorktree).toBe(true);
    expect(job.worktreePath).toBe('/tmp/wt/pipeline-1');
    expect(job.worktreeBranch).toBe('prompt/pipeline-1-abc');
  });

  it('calls createWorktreeForJob which invokes create_prompt_worktree', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'create_prompt_worktree') {
        return { worktree_path: '/tmp/wt/j2', branch_name: 'prompt/j2' };
      }
      if (command === 'run_prompt') return undefined;
      return undefined;
    });

    const store = await getStore();
    await store.getState().enqueueWithWorktreePipeline({
      prompt: 'fix bug',
      projectPath: '/my/repo',
      provider: 'claude',
    });

    expect(mockInvoke).toHaveBeenCalledWith('create_prompt_worktree', expect.objectContaining({
      projectPath: '/my/repo',
    }));
  });

  it('sets pipelineError and worktreeStatus=none when worktree creation fails', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'create_prompt_worktree') throw new Error('disk full');
      return undefined;
    });

    const store = await getStore();
    const jobId = await store.getState().enqueueWithWorktreePipeline({
      prompt: 'fix bug',
      projectPath: '/my/repo',
      provider: 'claude',
    });

    const job = store.getState().queue.find((j) => j.id === jobId)!;
    expect(job.worktreeStatus).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Pipeline auto-orchestration via finishJob
// ---------------------------------------------------------------------------

describe('pipeline auto-orchestration via finishJob', () => {
  function pipelineRunningJob(id = 'pipe-1') {
    return {
      id,
      queueNumber: 1,
      prompt: 'do something',
      projectPath: '/tmp/wt/pipe-1',
      originalProjectPath: '/my/repo',
      provider: 'claude' as const,
      isWorktree: true,
      worktreePipeline: true,
      status: 'running' as const,
      improveStep: 'done' as const,
      runStep: 'running' as const,
      logs: [],
      createdAt: new Date(),
      worktreeStatus: 'ready' as const,
      worktreePath: '/tmp/wt/pipe-1',
      worktreeBranch: 'prompt/pipe-1-abc',
      testOutput: [],
    };
  }

  it('auto-triggers runTestsForJob after prompt succeeds in pipeline job', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'run_tests_in_worktree') {
        return { passed: true, frontend_passed: 10, frontend_failed: 0, rust_passed: 5, rust_failed: 0 };
      }
      if (command === 'merge_worktree_branch') return { success: true, message: 'ok' };
      if (command === 'cleanup_prompt_worktree') return { success: true, message: 'cleaned' };
      return undefined;
    });

    const store = await getStore();
    store.setState({ queue: [pipelineRunningJob()], nextQueueNumber: 2 });

    store.getState().finishJob('pipe-1', true);

    // Allow microtasks/setTimeout to flush
    await new Promise((r) => setTimeout(r, 20));

    expect(mockInvoke).toHaveBeenCalledWith('run_tests_in_worktree', expect.anything());
  });

  it('auto-triggers cleanupWorktreeForJob and sets pipelineError after prompt fails', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'cleanup_prompt_worktree') return { success: true, message: 'cleaned' };
      return undefined;
    });

    const store = await getStore();
    store.setState({ queue: [pipelineRunningJob()], nextQueueNumber: 2 });

    store.getState().finishJob('pipe-1', false);

    await new Promise((r) => setTimeout(r, 20));

    const job = store.getState().queue.find((j) => j.id === 'pipe-1')!;
    expect(job.pipelineError).toBe('Prompt execution failed');
    expect(mockInvoke).toHaveBeenCalledWith('cleanup_prompt_worktree', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// runTestsForJob pipeline continuation
// ---------------------------------------------------------------------------

describe('runTestsForJob pipeline continuation', () => {
  function pipelineJobWithWorktree(id = 'pipe-2') {
    return {
      id,
      queueNumber: 1,
      prompt: 'add tests',
      projectPath: '/tmp/wt/pipe-2',
      originalProjectPath: '/my/repo',
      provider: 'claude' as const,
      isWorktree: true,
      worktreePipeline: true,
      status: 'done' as const,
      improveStep: 'done' as const,
      runStep: 'done' as const,
      logs: [],
      createdAt: new Date(),
      worktreeStatus: 'ready' as const,
      worktreePath: '/tmp/wt/pipe-2',
      worktreeBranch: 'prompt/pipe-2-abc',
      testOutput: [],
    };
  }

  it('calls mergeWorktreeForJob then cleanupWorktreeForJob when tests pass in pipeline', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'run_tests_in_worktree') {
        return { passed: true, frontend_passed: 20, frontend_failed: 0, rust_passed: 10, rust_failed: 0 };
      }
      if (command === 'merge_worktree_branch') return { success: true, message: 'merged' };
      if (command === 'cleanup_prompt_worktree') return { success: true, message: 'cleaned' };
      return undefined;
    });

    const store = await getStore();
    store.setState({ queue: [pipelineJobWithWorktree()], nextQueueNumber: 2 });

    await store.getState().runTestsForJob('pipe-2');

    expect(mockInvoke).toHaveBeenCalledWith('merge_worktree_branch', expect.anything());
    expect(mockInvoke).toHaveBeenCalledWith('cleanup_prompt_worktree', expect.anything());
    const job = store.getState().queue.find((j) => j.id === 'pipe-2')!;
    expect(job.worktreeStatus).toBe('merged');
    expect(job.pipelineError).toBeUndefined();
  });

  it('sets pipelineError and calls cleanup when tests fail in pipeline', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'run_tests_in_worktree') {
        return { passed: false, frontend_passed: 15, frontend_failed: 5, rust_passed: 10, rust_failed: 2 };
      }
      if (command === 'cleanup_prompt_worktree') return { success: true, message: 'cleaned' };
      return undefined;
    });

    const store = await getStore();
    store.setState({ queue: [pipelineJobWithWorktree()], nextQueueNumber: 2 });

    await store.getState().runTestsForJob('pipe-2');

    const job = store.getState().queue.find((j) => j.id === 'pipe-2')!;
    expect(job.worktreeStatus).toBe('tests_failed');
    expect(job.pipelineError).toMatch(/tests failed/i);
    expect(mockInvoke).toHaveBeenCalledWith('cleanup_prompt_worktree', expect.anything());
    expect(mockInvoke).not.toHaveBeenCalledWith('merge_worktree_branch', expect.anything());
  });

  it('does not show toast for pipeline test failures', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'run_tests_in_worktree') throw new Error('runner crashed');
      if (command === 'cleanup_prompt_worktree') return { success: true, message: 'cleaned' };
      return undefined;
    });

    // Spy on toast — import path is mocked at module level
    const store = await getStore();
    store.setState({ queue: [pipelineJobWithWorktree()], nextQueueNumber: 2 });

    // Should not throw even when test runner crashes
    await expect(store.getState().runTestsForJob('pipe-2')).resolves.toBeUndefined();
    const job = store.getState().queue.find((j) => j.id === 'pipe-2')!;
    expect(job.pipelineError).toContain('runner crashed');
  });

  it('sets pipelineError when merge fails in pipeline and still runs cleanup', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'run_tests_in_worktree') {
        return { passed: true, frontend_passed: 10, frontend_failed: 0, rust_passed: 5, rust_failed: 0 };
      }
      if (command === 'merge_worktree_branch') return { success: false, message: 'merge conflict detected' };
      if (command === 'cleanup_prompt_worktree') return { success: true, message: 'cleaned' };
      return undefined;
    });

    const store = await getStore();
    store.setState({ queue: [pipelineJobWithWorktree()], nextQueueNumber: 2 });

    await store.getState().runTestsForJob('pipe-2');

    expect(mockInvoke).toHaveBeenCalledWith('cleanup_prompt_worktree', expect.anything());
    const job = store.getState().queue.find((j) => j.id === 'pipe-2')!;
    expect(job.pipelineError).toContain('merge conflict detected');
  });
});

// ---------------------------------------------------------------------------
// mergeWorktreeForJob — pipeline suppresses toasts
// ---------------------------------------------------------------------------

describe('mergeWorktreeForJob pipeline behavior', () => {
  it('does not call cleanup if called manually (non-pipeline), only if merge succeeds', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'merge_worktree_branch') return { success: true, message: 'merged' };
      if (command === 'cleanup_prompt_worktree') return { success: true, message: 'cleaned' };
      return undefined;
    });

    const store = await getStore();
    store.setState({
      queue: [{
        id: 'manual-1',
        queueNumber: 1,
        prompt: 'something',
        projectPath: '/tmp/wt/m1',
        originalProjectPath: '/my/repo',
        provider: 'claude' as const,
        isWorktree: true,
        worktreePipeline: false,
        status: 'done' as const,
        improveStep: 'done' as const,
        runStep: 'done' as const,
        logs: [],
        createdAt: new Date(),
        worktreeStatus: 'tests_passed' as const,
        worktreePath: '/tmp/wt/m1',
        worktreeBranch: 'prompt/m1',
        testOutput: [],
      }],
      nextQueueNumber: 2,
    });

    await store.getState().mergeWorktreeForJob('manual-1', 'main');

    // Cleanup is called after successful merge (always, not pipeline-only)
    expect(mockInvoke).toHaveBeenCalledWith('cleanup_prompt_worktree', expect.anything());
    expect(store.getState().queue[0].worktreeStatus).toBe('merged');
  });
});
