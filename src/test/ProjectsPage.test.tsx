import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { ProjectsPage } from '../pages/ProjectsPage';

describe('ProjectsPage add project flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('disables browse and shows web-mode guidance when not running in tauri', async () => {
    render(<ProjectsPage />);

    expect(screen.getByText(/Web mode: the Browse button is unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse' })).toBeDisabled();
  });

  it('blocks add when the entered path is not absolute', async () => {
    const user = userEvent.setup();
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue([]);

    render(<ProjectsPage />);

    await user.type(screen.getByPlaceholderText('Paste an absolute path...'), 'relative/path');
    await user.click(screen.getByRole('button', { name: 'Check Path' }));

    expect(screen.getByText(/Use an absolute path/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Project' })).toBeDisabled();
    expect(mockInvoke).not.toHaveBeenCalledWith('create_project', expect.anything());
  });
});
