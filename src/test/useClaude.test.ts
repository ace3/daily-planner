import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../stores/settingsStore';
import { useClaude } from '../hooks/useClaude';

const baseSettings = {
  timezone_offset: 7,
  session1_kickstart: '09:00',
  planning_end: '11:00',
  session2_start: '14:00',
  warn_before_min: 15,
  autostart: false,
  claude_model: 'claude-sonnet-4-6',
  ai_provider: 'claude' as const,
  theme: 'dark',
  work_days: [1, 2, 3, 4, 5],
  show_in_tray: true,
  pomodoro_work_min: 25,
  pomodoro_break_min: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    settings: baseSettings,
    loading: false,
    error: null,
    globalPrompt: null,
  });
});

describe('useClaude provider routing', () => {
  it('uses Claude command when ai_provider is claude', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue('claude response');

    const { result } = renderHook(() => useClaude());

    await act(async () => {
      await result.current.send('Refine this prompt');
    });

    await waitFor(() => {
      expect(result.current.response).toBe('claude response');
    });

    expect(mockInvoke).toHaveBeenCalledWith('improve_prompt_with_claude', {
      prompt: 'Refine this prompt',
      projectPath: undefined,
      provider: 'claude',
      projectId: undefined,
    });
  });

  it('uses OpenCode provider when ai_provider is opencode', async () => {
    useSettingsStore.setState({
      settings: { ...baseSettings, ai_provider: 'opencode' },
    });

    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue('opencode response');

    const { result } = renderHook(() => useClaude());

    await act(async () => {
      await result.current.send('Refine this prompt');
    });

    await waitFor(() => {
      expect(result.current.response).toBe('opencode response');
    });

    expect(mockInvoke).toHaveBeenCalledWith('improve_prompt_with_claude', {
      prompt: 'Refine this prompt',
      projectPath: undefined,
      provider: 'opencode',
      projectId: undefined,
    });
  });

  it('routes through improve_prompt_with_claude when ai_provider is copilot_cli (legacy fallback)', async () => {
    useSettingsStore.setState({
      settings: { ...baseSettings, ai_provider: 'copilot_cli' },
    });

    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue('copilot response');

    const { result } = renderHook(() => useClaude());

    await act(async () => {
      await result.current.send('Refine this prompt');
    });

    await waitFor(() => {
      expect(result.current.response).toBe('copilot response');
    });

    expect(mockInvoke).toHaveBeenCalledWith('improve_prompt_with_claude', {
      prompt: 'Refine this prompt',
      projectPath: undefined,
      provider: 'copilot_cli',
      projectId: undefined,
    });
  });
});
