import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptBuilder } from '../components/claude/PromptBuilder';

vi.mock('../hooks/usePromptQueue', () => ({
  usePromptQueue: () => ({
    enqueue: vi.fn(),
    pendingCount: 0,
    queue: [],
    activeJob: null,
  }),
}));

vi.mock('../stores/promptTemplateStore', () => ({
  usePromptTemplateStore: () => ({
    promptTemplates: [],
    selectedTemplateId: null,
    loading: false,
    error: null,
    fetchPromptTemplates: vi.fn().mockResolvedValue(undefined),
    selectTemplate: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
  }),
}));

describe('PromptBuilder Use Task Title button', () => {
  const defaultProps = () => ({
    prompt: '',
    onPromptChange: vi.fn(),
    improved: '',
    onImprovedChange: vi.fn(),
    loading: false,
    error: null,
    onImprove: vi.fn(),
    onReset: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Use Task Title button', () => {
    render(<PromptBuilder {...defaultProps()} taskContext={{ title: 'Ship feature', notes: '' }} />);
    expect(
      screen.getByRole('button', { name: 'Use Task Title' }),
    ).toBeInTheDocument();
  });

  it('copies task title into prompt on click', async () => {
    const user = userEvent.setup();
    const onPromptChange = vi.fn();

    render(
      <PromptBuilder
        {...defaultProps()}
        onPromptChange={onPromptChange}
        taskContext={{ title: 'Implement auth middleware', notes: '' }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Use Task Title' }));
    expect(onPromptChange).toHaveBeenCalledWith('Implement auth middleware');
  });

  it('is disabled and no-ops when task title is empty', async () => {
    const user = userEvent.setup();
    const onPromptChange = vi.fn();

    render(
      <PromptBuilder
        {...defaultProps()}
        onPromptChange={onPromptChange}
        taskContext={{ title: '   ', notes: '' }}
      />,
    );

    const button = screen.getByRole('button', { name: 'Use Task Title' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onPromptChange).not.toHaveBeenCalled();
  });
});
