import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/tauri', () => ({
  improvePromptWithClaude: vi.fn(),
  updateTaskPrompt: vi.fn(),
}));

import { improvePromptWithClaude, updateTaskPrompt } from '../lib/tauri';
import { usePromptImproveStore } from '../stores/promptImproveStore';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('promptImproveStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptImproveStore.setState({ runsByTask: {} });
  });

  it('starts in running state and completes with persisted improved prompt', async () => {
    vi.mocked(improvePromptWithClaude).mockResolvedValue('Objective\nContext\nRequirements');
    vi.mocked(updateTaskPrompt).mockResolvedValue(undefined);

    const runId = await usePromptImproveStore.getState().startImprove({
      taskId: 'task-1',
      prompt: 'fix dashboard bug',
      provider: 'claude',
      projectPath: '/tmp/project',
      context: {
        title: 'Fix bug',
        notes: 'dashboard crashes',
        taskType: 'debug',
        projectId: 'project-1',
      },
    });

    const initialRuns = usePromptImproveStore.getState().runsByTask['task-1'];
    expect(initialRuns).toHaveLength(1);
    expect(initialRuns[0].id).toBe(runId);
    expect(initialRuns[0].status).toBe('running');

    await flush();

    const completedRuns = usePromptImproveStore.getState().runsByTask['task-1'];
    expect(completedRuns[0].status).toBe('completed');
    expect(completedRuns[0].improvedPrompt).toContain('Objective');
    expect(updateTaskPrompt).toHaveBeenCalledWith(
      'task-1',
      'fix dashboard bug',
      'Objective\nContext\nRequirements'
    );
  });

  it('marks run failed when improve request errors', async () => {
    vi.mocked(improvePromptWithClaude).mockRejectedValue(new Error('CLI failed'));

    await usePromptImproveStore.getState().startImprove({
      taskId: 'task-2',
      prompt: 'add tests',
      provider: 'claude',
      context: {
        title: 'Add tests',
        notes: '',
        taskType: 'test',
      },
    });

    await flush();

    const runs = usePromptImproveStore.getState().runsByTask['task-2'];
    expect(runs[0].status).toBe('failed');
    expect(runs[0].error).toContain('CLI failed');
    expect(updateTaskPrompt).not.toHaveBeenCalled();
  });

  it('supports multiple concurrent improve runs for the same task', async () => {
    let resolverA: ((value: string) => void) | null = null;
    let resolverB: ((value: string) => void) | null = null;
    const promiseA = new Promise<string>((resolve) => {
      resolverA = resolve;
    });
    const promiseB = new Promise<string>((resolve) => {
      resolverB = resolve;
    });

    vi.mocked(improvePromptWithClaude)
      .mockReturnValueOnce(promiseA as Promise<string>)
      .mockReturnValueOnce(promiseB as Promise<string>);
    vi.mocked(updateTaskPrompt).mockResolvedValue(undefined);

    await usePromptImproveStore.getState().startImprove({
      taskId: 'task-3',
      prompt: 'first prompt',
      provider: 'claude',
      context: { title: 'T', notes: '', taskType: 'feature' },
    });
    await usePromptImproveStore.getState().startImprove({
      taskId: 'task-3',
      prompt: 'second prompt',
      provider: 'claude',
      context: { title: 'T', notes: '', taskType: 'feature' },
    });

    const runs = usePromptImproveStore.getState().runsByTask['task-3'];
    expect(runs).toHaveLength(2);
    expect(runs.filter((r) => r.status === 'running')).toHaveLength(2);

    resolverA?.('Objective\nA');
    await flush();
    resolverB?.('Objective\nB');
    await flush();

    const doneRuns = usePromptImproveStore.getState().runsByTask['task-3'];
    expect(doneRuns.filter((r) => r.status === 'completed')).toHaveLength(2);
  });
});
