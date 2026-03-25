import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { ProjectsPage } from '../pages/ProjectsPage';
import { useProjectStore } from '../stores/projectStore';

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({
    projects: [],
    trashedProjects: [],
    selectedProject: null,
    loading: false,
    projectPrompt: null,
  } as any);
});

describe('ProjectsPage', () => {
  it('opens project detail when clicking a project row', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke
      .mockResolvedValueOnce([
        { id: 'p1', name: 'Daily Planner', path: '/tmp/dp', prompt: null, deleted_at: null, created_at: 'now' },
      ])
      .mockResolvedValueOnce([]);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<div>Project Detail Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Daily Planner');
    await user.click(screen.getByText('Daily Planner'));
    expect(await screen.findByText('Project Detail Page')).toBeInTheDocument();
  });

  it('moves project to trash after confirmation', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke
      .mockResolvedValueOnce([
        { id: 'p1', name: 'Repo A', path: '/tmp/repo-a', prompt: null, deleted_at: null, created_at: 'now' },
      ]) // initial get_projects
      .mockResolvedValueOnce([]) // initial get_trashed_projects
      .mockResolvedValueOnce(undefined) // delete_project
      .mockResolvedValueOnce([]) // refetch get_projects
      .mockResolvedValueOnce([
        { id: 'p1', name: 'Repo A', path: '/tmp/repo-a', prompt: null, deleted_at: 'now', created_at: 'now' },
      ]); // refetch get_trashed_projects

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    );

    await screen.findByText('Repo A');
    await user.click(screen.getByTitle('Remove project'));
    await user.click(screen.getByRole('button', { name: 'Move To Trash' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('delete_project', { id: 'p1' });
    });
    expect(await screen.findByText('Trash')).toBeInTheDocument();
  });

  it('restores a trashed project', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke
      .mockResolvedValueOnce([]) // initial get_projects
      .mockResolvedValueOnce([
        { id: 'p1', name: 'Repo B', path: '/tmp/repo-b', prompt: null, deleted_at: 'now', created_at: 'now' },
      ]) // initial get_trashed_projects
      .mockResolvedValueOnce(undefined) // restore_project
      .mockResolvedValueOnce([
        { id: 'p1', name: 'Repo B', path: '/tmp/repo-b', prompt: null, deleted_at: null, created_at: 'now' },
      ]) // get_projects
      .mockResolvedValueOnce([]); // get_trashed_projects

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    );

    await screen.findByText('Repo B');
    await user.click(screen.getByTitle('Restore project'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('restore_project', { id: 'p1' });
    });
  });

  it('hard deletes a trashed project after confirmation', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke
      .mockResolvedValueOnce([]) // initial get_projects
      .mockResolvedValueOnce([
        { id: 'p1', name: 'Repo C', path: '/tmp/repo-c', prompt: null, deleted_at: 'now', created_at: 'now' },
      ]) // initial get_trashed_projects
      .mockResolvedValueOnce(undefined) // hard_delete_project
      .mockResolvedValueOnce([]) // get_projects
      .mockResolvedValueOnce([]); // get_trashed_projects

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    );

    await screen.findByText('Repo C');
    await user.click(screen.getByTitle('Delete permanently'));
    await user.click(screen.getByRole('button', { name: 'Delete Permanently' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('hard_delete_project', { id: 'p1' });
    });
  });
});

