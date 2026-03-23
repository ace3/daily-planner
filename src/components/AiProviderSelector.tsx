import React, { useEffect, useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { detectAiProviders, getSetting } from '../lib/tauri';
import { useSettingsStore } from '../stores/settingsStore';
import type { AiProvider, AiProviderId } from '../types/settings';

const providerLabel: Record<AiProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  copilot: 'Copilot',
};

function normalizeProvider(value: string | null | undefined): AiProviderId | null {
  switch (value) {
    case 'claude':
    case 'codex':
    case 'opencode':
    case 'copilot':
      return value;
    case 'copilot_cli':
      return 'copilot';
    default:
      return null;
  }
}

function pickProvider(providers: AiProvider[], configured: AiProviderId | null): AiProviderId | null {
  const providerIds = new Set(providers.map((provider) => provider.id));

  if (configured && providerIds.has(configured)) {
    return configured;
  }

  if (providerIds.has('claude')) {
    return 'claude';
  }

  return providers[0]?.id ?? null;
}

interface AiProviderSelectorProps {
  className?: string;
  mobileOptimized?: boolean;
}

export const AiProviderSelector: React.FC<AiProviderSelectorProps> = ({ className = '', mobileOptimized = false }) => {
  const activeProvider = useSettingsStore((state) => state.activeProvider);
  const availableProviders = useSettingsStore((state) => state.availableProviders);
  const setAvailableProviders = useSettingsStore((state) => state.setAvailableProviders);
  const setActiveProvider = useSettingsStore((state) => state.setActiveProvider);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [providers, storedProvider] = await Promise.all([
          detectAiProviders(),
          getSetting('active_ai_provider'),
        ]);

        if (cancelled) {
          return;
        }

        setAvailableProviders(providers);
        const selected = pickProvider(providers, normalizeProvider(storedProvider));
        if (selected) {
          await setActiveProvider(selected);
        }
      } catch {
        if (!cancelled) {
          setAvailableProviders([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [setActiveProvider, setAvailableProviders]);

  const selectedProvider = useMemo(() => {
    const matched = availableProviders.find((provider) => provider.id === activeProvider);
    return matched ?? availableProviders[0] ?? null;
  }, [activeProvider, availableProviders]);

  if (loading) {
    return (
      <span className="text-xs text-gray-400 dark:text-[#484F58]">Detecting CLI…</span>
    );
  }

  if (availableProviders.length === 0) {
    return <span className="text-xs text-gray-400 dark:text-[#6E7681]">No CLI detected</span>;
  }

  if (availableProviders.length === 1 && selectedProvider) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 dark:border-[#30363D] dark:text-[#C9D1D9] ${mobileOptimized ? 'min-h-[44px] min-w-[44px] px-3' : ''} ${className}`}
      >
        <Bot size={12} className="text-gray-500 dark:text-[#8B949E]" />
        <span>{providerLabel[selectedProvider.id]}</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 dark:border-[#30363D] ${mobileOptimized ? 'min-h-[44px] min-w-[44px] px-3' : ''} ${className}`}
    >
      <Bot size={12} className="text-gray-500 dark:text-[#8B949E]" />
      <select
        aria-label="Active AI provider"
        value={selectedProvider?.id ?? 'claude'}
        onChange={async (event) => {
          const selected = normalizeProvider(event.target.value);
          if (!selected) {
            return;
          }
          await setActiveProvider(selected);
        }}
        className={`bg-transparent text-xs text-gray-700 outline-none dark:text-[#C9D1D9] ${mobileOptimized ? 'min-h-[44px] min-w-[44px] pr-5' : ''}`}
      >
        {availableProviders.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {providerLabel[provider.id]}
          </option>
        ))}
      </select>
    </div>
  );
};
