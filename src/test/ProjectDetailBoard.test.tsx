import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { ProjectDetail } from '../pages/ProjectDetail';
import { useProjectStore } from '../stores/projectStore';
import type { Task } from '../types/task';

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    title: 'Task One',
    description: '',
    notes: '',
    task_type: 'other',
    priority: 2,
    status: 'todo',
    estimated_min: null,
    actual_min: null,
    raw_prompt: null,
    improved_prompt: null,
    prompt_output: null,
    job_status: 'idle',
    job_id: null,
    provider: null,
    carried_from: null,
    position: 0,
    created_at: 'now',
    updated_at: 'now',
    completed_at: null,
    project_id: 'p1',
    worktree_path: null,
    worktree_branch: null,
    worktree_status: null,
    deadline: null,
    plan: null,
    review_output: null,
    review_status: 'none',
    git_workflow: false,
    agent: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({
    projects: [{ id: 'p1', name: 'Daily Planner', path: '/tmp/daily', prompt: null, deleted_at: null, created_at: 'now' }],
    trashedProjects: [],
    selectedProject: null,
    loading: false,
    projectPrompt: null,
  } as any);
});

describe('ProjectDetail board', () => {
  it('renders board tasks for selected project and hides project filter', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce([
      makeTask({ id: 't1', title: 'Project Task A', project_id: 'p1' }),
      makeTask({ id: 't2', title: 'Project Task B', project_id: 'p1', status: 'planned' }),
    ]);

    render(
      <MemoryRouter initialEntries={['/projects/p1']}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Project Task A')).toBeInTheDocument();
    expect(await screen.findByText('Project Task B')).toBeInTheDocument();
    expect(screen.queryByText('All Projects')).not.toBeInTheDocument();
  });
});
