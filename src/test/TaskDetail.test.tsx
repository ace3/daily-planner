import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TaskDetail } from '../pages/TaskDetail';
import type { Task } from '../types/task';

const mocks = vi.hoisted(() => ({
  getTasks: vi.fn(),
  getTask: vi.fn(),
  getJobsByTask: vi.fn(),
}));

vi.mock('../lib/tauri', () => ({
  getTasks: mocks.getTasks,
  getTask: mocks.getTask,
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  updateTaskPrompt: vi.fn(),
  runTaskPrompt: vi.fn(),
  cancelPromptRun: vi.fn(),
  getJobsByTask: mocks.getJobsByTask,
  gitDiff: vi.fn(),
  gitStageAll: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
}));

vi.mock('../stores/mobileStore', () => ({
  useMobileStore: () => ({ mobileMode: false }),
}));

vi.mock('../stores/projectStore', () => ({
  useProjectStore: () => ({ projects: [] }),
}));

vi.mock('../stores/promptImproveStore', () => ({
  usePromptImproveStore: (selector: (state: { startImprove: () => Promise<void>; runsByTask: Record<string, never[]> }) => unknown) =>
    selector({ startImprove: vi.fn(), runsByTask: {} }),
}));

const sampleTask: Task = {
  id: 'task-123',
  title: 'Fix blank detail',
  notes: 'Open detail from project list',
  task_type: 'other',
  priority: 2,
  status: 'pending',
  estimated_min: null,
  actual_min: null,
  raw_prompt: null,
  improved_prompt: null,
  prompt_output: null,
  job_status: 'idle',
  job_id: null,
  provider: null,
  carried_from: null,
  position: 1,
  created_at: '2026-03-25T00:00:00Z',
  updated_at: '2026-03-25T00:00:00Z',
  completed_at: null,
  project_id: null,
  worktree_path: null,
  worktree_branch: null,
  worktree_status: null,
};

describe('TaskDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTask.mockResolvedValue(sampleTask);
    mocks.getJobsByTask.mockResolvedValue([]);
  });

  it('loads task by id directly for detail view', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks/task-123']}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Fix blank detail')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getTask).toHaveBeenCalledWith('task-123'));
  });
});
