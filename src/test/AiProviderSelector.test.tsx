import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';

beforeEach(async () => {
  vi.clearAllMocks();
  const { useSettingsStore } = await import('../stores/settingsStore');
  useSettingsStore.setState({
    activeProvider: 'claude',
    availableProviders: [],
    error: null,
  });
});

describe('AiProviderSelector', () => {
  it('shows muted label when no provider CLI is detected', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'detect_ai_providers') return [];
      if (command === 'get_setting') return null;
      if (command === 'set_setting') return undefined;
      throw new Error('Unexpected command');
    });

    const { AiProviderSelector } = await import('../components/AiProviderSelector');
    render(<AiProviderSelector />);

    await waitFor(() => {
      expect(screen.getByText('No CLI detected')).toBeInTheDocument();
    });
  });

  it('renders a static badge when only one provider is available', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'detect_ai_providers') {
        return [{ id: 'claude', name: 'Claude Code', available: true }];
      }
      if (command === 'get_setting') return 'claude';
      if (command === 'set_setting') return undefined;
      throw new Error('Unexpected command');
    });

    const { AiProviderSelector } = await import('../components/AiProviderSelector');
    render(<AiProviderSelector />);

    await waitFor(() => {
      expect(screen.getByText('Claude')).toBeInTheDocument();
    });
    expect(screen.queryByRole('combobox', { name: 'Active AI provider' })).not.toBeInTheDocument();
  });

  it('persists selection changes when multiple providers are available', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'detect_ai_providers') {
        return [
          { id: 'claude', name: 'Claude Code', available: true },
          { id: 'codex', name: 'OpenAI Codex CLI', available: true },
        ];
      }
      if (command === 'get_setting') return 'claude';
      if (command === 'set_setting') return undefined;
      throw new Error('Unexpected command');
    });

    const { AiProviderSelector } = await import('../components/AiProviderSelector');
    render(<AiProviderSelector />);

    const selector = await screen.findByRole('combobox', { name: 'Active AI provider' });
    await userEvent.selectOptions(selector, 'codex');

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_setting', {
        key: 'active_ai_provider',
        value: 'codex',
      });
      expect(mockInvoke).toHaveBeenCalledWith('set_setting', {
        key: 'ai_provider',
        value: 'codex',
      });
    });
  });
});
