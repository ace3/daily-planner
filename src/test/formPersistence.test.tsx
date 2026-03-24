import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskForm } from '../components/tasks/TaskForm';
import { SettingsPage } from '../pages/Settings';

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('form state persistence across remounts', () => {
  it('resets TaskForm draft after remounting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    const { unmount } = render(
      <TaskForm
        onSubmit={onSubmit}
        compact
      />,
    );

    const taskInput = screen.getByPlaceholderText('Add task... (Enter to add)');
    await user.type(taskInput, 'Persist me');
    expect(taskInput).toHaveValue('Persist me');

    unmount();

    render(
      <TaskForm
        onSubmit={onSubmit}
        compact
      />,
    );

    expect(screen.getByPlaceholderText('Add task... (Enter to add)')).toHaveValue('');
  });

  it('reloads Settings values from store after remounting', async () => {
    const user = userEvent.setup();

    const { unmount } = render(<SettingsPage />);

    const timezoneInput = screen.getAllByRole('spinbutton')[0];
    await user.clear(timezoneInput);
    await user.type(timezoneInput, '9');
    expect(timezoneInput).toHaveValue(9);

    unmount();

    render(<SettingsPage />);

    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(7);
  });
});
