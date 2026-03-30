import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { ProjectsPage } from '../pages/ProjectsPage';
import { useProjectStore } from '../stores/projectStore';
import { toast } from '../components/ui/Toast';

function setupProjectInvokeMock(opts?: {
  projects?: any[];
  trashedProjects?: any[];
  validateResult?: { exists: boolean; is_directory: boolean; normalized_path: string };
}) {
  const state = {
    projects: opts?.projects ?? [],
    trashedProjects: opts?.trashedProjects ?? [],
    validateResult: opts?.validateResult ?? { exists: true, is_directory: true, normalized_path: '/tmp/new-repo' },
  };

  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === 'get_projects') return state.projects;
    if (cmd === 'get_trashed_projects') return state.trashedProjects;
    if (cmd === 'validate_project_path') return state.validateResult;
    if (cmd === 'create_project') {
      const input = args?.input;
      state.projects = [
        ...state.projects,
        { id: 'new-project-id', name: input.name, path: input.path, prompt: null, deleted_at: null, created_at: 'now' },
      ];
      return 'new-project-id';
    }
    if (cmd === 'delete_project') {
      const id = args?.id;
      const match = state.projects.find((p) => p.id === id);
      state.projects = state.projects.filter((p) => p.id !== id);
      if (match) state.trashedProjects = [...state.trashedProjects, { ...match, deleted_at: 'now' }];
      return undefined;
    }
    if (cmd === 'restore_project') {
      const id = args?.id;
      const match = state.trashedProjects.find((p) => p.id === id);
      state.trashedProjects = state.trashedProjects.filter((p) => p.id !== id);
      if (match) state.projects = [...state.projects, { ...match, deleted_at: null }];
      return undefined;
    }
    if (cmd === 'hard_delete_project') {
      const id = args?.id;
      state.trashedProjects = state.trashedProjects.filter((p) => p.id !== id);
      return undefined;
    }
    if (cmd === 'set_project_prompt') return undefined;
    return undefined;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(dialogOpen).mockResolvedValue(null);
  vi.mocked(invoke).mockResolvedValue(undefined as any);
  useProjectStore.setState({
    projects: [],
    trashedProjects: [],
    selectedProject: null,
    loading: false,
    projectPrompt: null,
  } as any);
});

afterEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined as any);
  vi.mocked(dialogOpen).mockReset();
  vi.mocked(dialogOpen).mockResolvedValue(null);
});

describe('ProjectsPage', () => {
  it('opens project detail when clicking a project row', async () => {
    setupProjectInvokeMock({
      projects: [
        { id: 'p1', name: 'Daily Planner', path: '/tmp/dp', prompt: null, deleted_at: null, created_at: 'now' },
      ],
    });

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
    expect(useProjectStore.getState().selectedProject?.id).toBe('p1');
    expect(await screen.findByText('Project Detail Page')).toBeInTheDocument();
  });

  it('allows typing a local path and uses it when creating project', async () => {
    setupProjectInvokeMock({
      validateResult: {
        exists: true,
        is_directory: true,
        normalized_path: '/tmp/new-repo',
      },
    });
    const mockInvoke = vi.mocked(invoke);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    );

    const pathInput = await screen.findByPlaceholderText('Select a folder...');
    await user.type(pathInput, '/tmp/new-repo');
    await user.click(screen.getByRole('button', { name: 'Add Project' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('validate_project_path', { path: '/tmp/new-repo' });
      expect(mockInvoke).toHaveBeenCalledWith('create_project', {
        input: { name: 'new-repo', path: '/tmp/new-repo' },
      });
    });
  });

  it('shows validation error and blocks create when path is invalid', async () => {
    setupProjectInvokeMock({
      validateResult: {
        exists: false,
        is_directory: false,
        normalized_path: '/tmp/missing',
      },
    });
    const mockInvoke = vi.mocked(invoke);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    );

    const pathInput = await screen.findByPlaceholderText('Select a folder...');
    await user.type(pathInput, '/tmp/missing');
    await user.click(screen.getByRole('button', { name: 'Add Project' }));

    expect(await screen.findByText('Path does not exist.')).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith('create_project', expect.anything());
  });

  it('populates path and default project name from browse', async () => {
    setupProjectInvokeMock();

    vi.mocked(dialogOpen).mockResolvedValueOnce('/tmp/my-browsed-repo');

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Browse' }));

    expect(await screen.findByDisplayValue('/tmp/my-browsed-repo')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('my-browsed-repo')).toBeInTheDocument();
  });

  it('does not crash when browse fails', async () => {
    setupProjectInvokeMock();

    vi.mocked(dialogOpen).mockRejectedValueOnce(new Error('Dialog unavailable'));

    const errorSpy = vi.spyOn(toast, 'error');

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Browse' }));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('Could not open folder browser.');
    });
  });

  it('moves project to trash after confirmation', async () => {
    setupProjectInvokeMock({
      projects: [
        { id: 'p1', name: 'Repo A', path: '/tmp/repo-a', prompt: null, deleted_at: null, created_at: 'now' },
      ],
    });
    const mockInvoke = vi.mocked(invoke);

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
    setupProjectInvokeMock({
      trashedProjects: [
        { id: 'p1', name: 'Repo B', path: '/tmp/repo-b', prompt: null, deleted_at: 'now', created_at: 'now' },
      ],
    });
    const mockInvoke = vi.mocked(invoke);

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
    setupProjectInvokeMock({
      trashedProjects: [
        { id: 'p1', name: 'Repo C', path: '/tmp/repo-c', prompt: null, deleted_at: 'now', created_at: 'now' },
      ],
    });
    const mockInvoke = vi.mocked(invoke);

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
