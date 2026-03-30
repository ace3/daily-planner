import React, { useState, useEffect, useCallback } from 'react';
import { Settings as SettingsIcon, Clock, Database, RotateCcw, Upload, MessageSquare, Save, Shield, ShieldCheck, ShieldX, Trash2, RefreshCw, HardDrive, ChevronDown, ChevronRight, Bell, Info, X, Terminal } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useSettingsStore } from '../stores/settingsStore';
import { useTaskStore } from '../stores/taskStore';
import { useProviderStore } from '../stores/providerStore';
import {
  backupData, restoreData, resetAppData, testTelegramNotification,
  triggerBackupNow, listBackupSessions, verifyBackupSession, verifyAllBackupSessions,
  restoreFromBackupSession, deleteBackupSession, getBackupSettings, setBackupSettings,
  type BackupSessionInfo, type BackupSettings,
} from '../lib/tauri';
import { toast } from '../components/ui/Toast';

interface SettingsDraft {
  timezone_offset: string;
  default_model_codex: string;
  default_model_claude: string;
  default_model_opencode: string;
  default_model_copilot: string;
  promptDraft: string;
  telegram_bot_token: string;
  telegram_channel_id: string;
  tunnel_name: string;
  tunnel_hostname: string;
  initializedFromSettings: boolean;
  initializedPrompt: boolean;
}

export const SettingsPage: React.FC = () => {
  const { settings, fetchSettings, updateSetting, globalPrompt, fetchGlobalPrompt, setGlobalPrompt } = useSettingsStore();
  const { fetchTasks } = useTaskStore();
  const { claudeAvailable, opencodeAvailable, codexAvailable, copilotAvailable, checkAvailability } = useProviderStore();
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [dataOpLoading, setDataOpLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [showTunnelGuide, setShowTunnelGuide] = useState(false);

  // Auto Backup state
  const [backupSessions, setBackupSessions] = useState<BackupSessionInfo[]>([]);
  const [backupSettings, setBackupSettingsState] = useState<BackupSettings | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupNowLoading, setBackupNowLoading] = useState(false);
  const [verifyAllLoading, setVerifyAllLoading] = useState(false);
  const [sessionActions, setSessionActions] = useState<Record<string, string>>({});
  const [restoreSessionId, setRestoreSessionId] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft>({
    timezone_offset: '',
    default_model_codex: '',
    default_model_claude: '',
    default_model_opencode: '',
    default_model_copilot: '',
    promptDraft: '',
    telegram_bot_token: '',
    telegram_channel_id: '',
    tunnel_name: '',
    tunnel_hostname: '',
    initializedFromSettings: false,
    initializedPrompt: false,
  });

  const loadBackupData = useCallback(async () => {
    setBackupLoading(true);
    try {
      const [sessions, bSettings] = await Promise.all([listBackupSessions(), getBackupSettings()]);
      setBackupSessions(sessions ?? []);
      setBackupSettingsState(bSettings ?? null);
    } catch (e) {
      toast.error(`Failed to load backup data: ${String(e)}`);
    } finally {
      setBackupLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchGlobalPrompt();
    loadBackupData();
    checkAvailability();
  }, []);

  useEffect(() => {
    if (!settings) return;
    const needsModelDefaults =
      !draft.default_model_codex ||
      !draft.default_model_claude ||
      !draft.default_model_opencode ||
      !draft.default_model_copilot;
    if (draft.initializedFromSettings && !needsModelDefaults) return;
    setDraft((prev) => ({
      ...prev,
      timezone_offset: String(settings.timezone_offset),
      default_model_codex: settings.default_model_codex,
      default_model_claude: settings.default_model_claude,
      default_model_opencode: settings.default_model_opencode,
      default_model_copilot: settings.default_model_copilot,
      telegram_bot_token: settings.telegram_bot_token ?? '',
      telegram_channel_id: settings.telegram_channel_id ?? '',
      tunnel_name: settings.tunnel_name ?? '',
      tunnel_hostname: settings.tunnel_hostname ?? '',
      initializedFromSettings: true,
    }));
  }, [
    settings,
    draft.initializedFromSettings,
    draft.default_model_codex,
    draft.default_model_claude,
    draft.default_model_opencode,
    draft.default_model_copilot,
    setDraft,
  ]);

  useEffect(() => {
    if (draft.initializedPrompt) return;
    setDraft((prev) => ({
      ...prev,
      promptDraft: globalPrompt ?? '',
      initializedPrompt: true,
    }));
  }, [globalPrompt, draft.initializedPrompt, setDraft]);

  if (!settings) return <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-[#484F58] text-sm">Loading...</div>;

  const handleSave = async (key: string, value: string) => {
    try {
      await updateSetting(key as any, value);
      toast.success('Setting saved');
    } catch {
      toast.error('Failed to save setting');
    }
  };

  const handleSaveDefaultModel = async (
    key: 'default_model_codex' | 'default_model_claude' | 'default_model_opencode' | 'default_model_copilot',
    value: string,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) {
      toast.error('Model value cannot be empty');
      return;
    }
    setDraft((prev) => ({ ...prev, [key]: trimmed }));
    await handleSave(key, trimmed);
  };

  const handleTestTelegram = async () => {
    setTelegramTesting(true);
    try {
      await testTelegramNotification();
      toast.success('Test message sent to Telegram');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTelegramTesting(false);
    }
  };

  const handleSaveGlobalPrompt = async () => {
    setPromptSaving(true);
    try {
      await setGlobalPrompt(draft.promptDraft);
      toast.success('Global prompt saved');
    } catch {
      toast.error('Failed to save global prompt');
    } finally {
      setPromptSaving(false);
    }
  };

  const handleBackup = async () => {
    setDataOpLoading(true);
    try {
      const result = await backupData();
      if (result !== 'cancelled') toast.success(`Backup saved to ${result}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDataOpLoading(false);
    }
  };

  const handleRestore = async () => {
    setShowRestoreConfirm(false);
    setDataOpLoading(true);
    try {
      const result = await restoreData();
      if (result === 'cancelled') return;
      await Promise.all([fetchSettings(), fetchTasks()]);
      toast.success('Data restored successfully');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDataOpLoading(false);
    }
  };

  const handleReset = async (checkValues?: Record<string, boolean>) => {
    setShowResetConfirm(false);
    setDataOpLoading(true);
    try {
      const keepSettings = checkValues?.['keep_settings'] ?? true;
      const keepBuiltinTemplates = checkValues?.['keep_builtin_templates'] ?? true;
      await resetAppData(keepSettings, keepBuiltinTemplates);
      await Promise.all([fetchSettings(), fetchTasks()]);
      toast.success('App data cleared');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDataOpLoading(false);
    }
  };

  const handleBackupNow = async () => {
    setBackupNowLoading(true);
    try {
      const session = await triggerBackupNow();
      toast.success(`Backup created: ${session.item_count} items`);
      await loadBackupData();
    } catch (e) {
      toast.error(`Backup failed: ${String(e)}`);
    } finally {
      setBackupNowLoading(false);
    }
  };

  const handleVerifyAll = async () => {
    setVerifyAllLoading(true);
    try {
      await verifyAllBackupSessions();
      await loadBackupData();
      toast.success('All sessions verified');
    } catch (e) {
      toast.error(`Verify failed: ${String(e)}`);
    } finally {
      setVerifyAllLoading(false);
    }
  };

  const handleVerifySession = async (id: string) => {
    setSessionActions((p) => ({ ...p, [id]: 'verifying' }));
    try {
      const updated = await verifyBackupSession(id);
      setBackupSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
      toast.success(`Integrity: ${updated.integrity_status}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSessionActions((p) => { const n = { ...p }; delete n[id]; return n; });
    }
  };

  const handleDeleteSession = async (id: string) => {
    setSessionActions((p) => ({ ...p, [id]: 'deleting' }));
    try {
      await deleteBackupSession(id);
      setBackupSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success('Session deleted');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSessionActions((p) => { const n = { ...p }; delete n[id]; return n; });
    }
  };

  const handleRestoreSession = async () => {
    if (!restoreSessionId) return;
    const id = restoreSessionId;
    setRestoreSessionId(null);
    setSessionActions((p) => ({ ...p, [id]: 'restoring' }));
    try {
      await restoreFromBackupSession(id);
      await Promise.all([fetchSettings(), fetchTasks()]);
      toast.success('Restored from backup session');
    } catch (e) {
      toast.error(`Restore failed: ${String(e)}`);
    } finally {
      setSessionActions((p) => { const n = { ...p }; delete n[id]; return n; });
    }
  };

  const handleSaveBackupSettings = async (patch: Partial<BackupSettings>) => {
    if (!backupSettings) return;
    const updated = { ...backupSettings, ...patch };
    setBackupSettingsState(updated);
    try {
      await setBackupSettings(updated.enabled, updated.interval_min, updated.max_sessions);
    } catch (e) {
      toast.error(`Failed to save backup settings: ${String(e)}`);
    }
  };

  const inputClass = "bg-white border border-gray-200 rounded-lg text-gray-900 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors px-3 py-2 dark:bg-[#161B22] dark:border-[#30363D] dark:text-[#E6EDF3]";
  const sectionClass = "rounded-xl border border-gray-200 bg-white overflow-hidden dark:border-[#30363D] dark:bg-[#161B22]";
  const sectionHeaderClass = "flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-[#30363D]";
  const labelClass = "text-xs font-medium text-gray-500 uppercase tracking-wide dark:text-[#8B949E]";

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <SettingsIcon size={16} className="text-gray-500 dark:text-[#8B949E]" />
          <h1 className="text-base font-semibold text-gray-900 dark:text-[#E6EDF3]">Settings</h1>
        </div>

        {/* CLI Tools Status */}
        {(() => {
          const tools = [
            { name: 'claude', label: 'Claude CLI', available: claudeAvailable },
            { name: 'codex', label: 'OpenAI Codex CLI', available: codexAvailable },
            { name: 'opencode', label: 'OpenCode', available: opencodeAvailable },
            { name: 'copilot', label: 'GitHub Copilot CLI', available: copilotAvailable },
          ];
          return (
            <section className={sectionClass}>
              <div className={sectionHeaderClass}>
                <Terminal size={14} className="text-gray-500 dark:text-[#8B949E]" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">CLI Tools</h2>
              </div>
              <div className="px-4 py-2 divide-y divide-gray-100 dark:divide-[#21262D]">
                {tools.map((tool) => (
                  <div key={tool.name} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-gray-700 dark:text-[#E6EDF3]">{tool.label}</span>
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${tool.available ? 'text-green-400' : 'text-gray-500 dark:text-[#484F58]'}`}>
                      <span className={`w-2 h-2 rounded-full ${tool.available ? 'bg-green-500' : 'bg-gray-400 dark:bg-[#484F58]'}`} />
                      {tool.available ? 'Installed' : 'Not found'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}

        {/* Timezone & Schedule */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <Clock size={14} className="text-gray-500 dark:text-[#8B949E]" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">Schedule</h2>
          </div>
          <div className="p-4 space-y-4">
            {/* Timezone offset */}
            <div className="space-y-2">
              <label className={labelClass}>UTC Offset (e.g. 7 for UTC+7)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={draft.timezone_offset}
                  min={-12}
                  max={14}
                  step={1}
                  onChange={(e) => setDraft((prev) => ({ ...prev, timezone_offset: e.target.value }))}
                  onBlur={(e) => handleSave('timezone_offset', e.target.value)}
                  className={`w-24 ${inputClass}`}
                />
                <span className="text-xs text-gray-400 dark:text-[#484F58] self-center">
                  Currently UTC{settings.timezone_offset >= 0 ? '+' : ''}{settings.timezone_offset}
                </span>
              </div>
            </div>

          </div>
        </section>

        {/* Default models */}
        <section className={sectionClass}>
          <div className="px-4 py-3 border-b border-gray-200 dark:border-[#30363D]">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">Default Models</h2>
          </div>
          <div className="p-4 space-y-3">
            {[
              {
                key: 'default_model_codex' as const,
                label: 'Codex',
                options: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3'],
              },
              {
                key: 'default_model_claude' as const,
                label: 'Claude',
                options: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
              },
              {
                key: 'default_model_opencode' as const,
                label: 'OpenCode',
                options: null,
              },
              {
                key: 'default_model_copilot' as const,
                label: 'Copilot',
                options: [
                  'claude-sonnet-4.5',
                  'claude-sonnet-4',
                  'claude-opus-4.5',
                  'claude-haiku-4.5',
                  'gpt-5.1',
                  'gpt-5.1-codex',
                  'gpt-5.1-codex-mini',
                  'gpt-5',
                  'gpt-5-mini',
                  'gpt-4.1',
                  'gemini-3-pro',
                  'gemini-3-pro-preview',
                ],
              },
            ].map(({ key, label, options }) => (
              <div key={key} className="space-y-1.5">
                <label className={labelClass}>{label}</label>
                <div className="flex gap-2">
                  <input
                    {...(options ? { list: `${key}-models` } : {})}
                    value={draft[key]}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                    onBlur={(e) => void handleSaveDefaultModel(key, e.target.value)}
                    placeholder={`Default ${label} model`}
                    className={`flex-1 ${inputClass}`}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleSaveDefaultModel(key, draft[key])}
                  >
                    Save
                  </Button>
                  {options && (
                    <datalist id={`${key}-models`}>
                      {options.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  )}
                </div>
                <p className="text-xs text-gray-400 dark:text-[#484F58]">
                  {options ? 'Choose from suggestions or type a custom model.' : 'Type a custom model name.'}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Work days */}
        <section className={sectionClass}>
          <div className="px-4 py-3 border-b border-gray-200 dark:border-[#30363D]">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">Work Days</h2>
          </div>
          <div className="p-4">
            <div className="flex gap-1.5">
              {[
                { day: 0, label: 'Su' },
                { day: 1, label: 'Mo' },
                { day: 2, label: 'Tu' },
                { day: 3, label: 'We' },
                { day: 4, label: 'Th' },
                { day: 5, label: 'Fr' },
                { day: 6, label: 'Sa' },
              ].map(({ day, label }) => {
                const active = settings.work_days.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => {
                      const newDays = active
                        ? settings.work_days.filter((d) => d !== day)
                        : [...settings.work_days, day].sort();
                      handleSave('work_days', JSON.stringify(newDays));
                    }}
                    className={`w-9 h-9 rounded-lg text-xs font-medium transition-colors cursor-pointer
                      ${active ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-gray-50 text-gray-400 border border-gray-200 hover:border-gray-300 dark:bg-[#0F1117] dark:text-[#484F58] dark:border-[#21262D] dark:hover:border-[#30363D]'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <Bell size={14} className="text-gray-500 dark:text-[#8B949E]" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">Notifications</h2>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-xs text-gray-400 dark:text-[#484F58]">
              When a Cloudflare tunnel is active, the public URL will be sent to this Telegram channel. A new message is sent only when the URL changes.
            </p>

            {/* Named tunnel config */}
            <div className="border-t border-gray-100 dark:border-[#21262D] pt-4 space-y-3">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium text-gray-700 dark:text-[#C9D1D9]">Named Tunnel (static domain)</p>
                <button
                  onClick={() => setShowTunnelGuide(true)}
                  className="text-gray-400 hover:text-blue-500 dark:text-[#484F58] dark:hover:text-[#7DD3FC] transition-colors cursor-pointer"
                  title="Setup guide"
                >
                  <Info size={13} />
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-[#484F58]">
                Leave blank to use a random <code className="font-mono">trycloudflare.com</code> URL. To use a static domain, set both fields below (requires <code className="font-mono">cloudflared tunnel login</code> and a DNS route).
              </p>
              <div className="space-y-1.5">
                <label className={labelClass}>Tunnel Name</label>
                <input
                  type="text"
                  value={draft.tunnel_name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, tunnel_name: e.target.value }))}
                  onBlur={(e) => handleSave('tunnel_name', e.target.value)}
                  placeholder="daily-planner"
                  className={`w-full ${inputClass}`}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Tunnel Hostname</label>
                <input
                  type="text"
                  value={draft.tunnel_hostname}
                  onChange={(e) => setDraft((prev) => ({ ...prev, tunnel_hostname: e.target.value }))}
                  onBlur={(e) => handleSave('tunnel_hostname', e.target.value)}
                  placeholder="planner.yourdomain.com"
                  className={`w-full ${inputClass}`}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="border-t border-gray-100 dark:border-[#21262D] pt-4">
              <p className="text-xs font-medium text-gray-700 dark:text-[#C9D1D9] mb-3">Telegram Notification</p>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Telegram Bot Token</label>
              <input
                type="password"
                value={draft.telegram_bot_token}
                onChange={(e) => setDraft((prev) => ({ ...prev, telegram_bot_token: e.target.value }))}
                onBlur={(e) => handleSave('telegram_bot_token', e.target.value)}
                placeholder="1234567890:ABCdef..."
                className={`w-full ${inputClass}`}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Telegram Channel ID</label>
              <input
                type="text"
                value={draft.telegram_channel_id}
                onChange={(e) => setDraft((prev) => ({ ...prev, telegram_channel_id: e.target.value }))}
                onBlur={(e) => handleSave('telegram_channel_id', e.target.value)}
                placeholder="-1001234567890 or @channelname"
                className={`w-full ${inputClass}`}
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end pt-1">
              <Button
                variant="secondary"
                size="sm"
                icon={<Bell size={12} />}
                onClick={handleTestTelegram}
                loading={telegramTesting}
              >
                Send Test Message
              </Button>
            </div>
          </div>

          {/* Tunnel Setup Guide Modal */}
          {showTunnelGuide && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={(e) => { if (e.target === e.currentTarget) setShowTunnelGuide(false); }}
            >
              <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-[#30363D] dark:bg-[#161B22] flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#30363D] shrink-0">
                  <div className="flex items-center gap-2">
                    <Info size={14} className="text-blue-500 dark:text-[#7DD3FC]" />
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">Cloudflare Named Tunnel Setup</h2>
                  </div>
                  <button onClick={() => setShowTunnelGuide(false)} className="text-gray-400 hover:text-gray-600 dark:text-[#484F58] dark:hover:text-[#8B949E] cursor-pointer transition-colors">
                    <X size={14} />
                  </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto p-4 space-y-5 text-xs text-gray-600 dark:text-[#8B949E]">

                  <p>A <strong className="text-gray-800 dark:text-[#C9D1D9]">named tunnel</strong> gives you a permanent static URL (e.g. <code className="font-mono bg-gray-100 dark:bg-[#0F1117] px-1 py-0.5 rounded">planner.yourdomain.com</code>) instead of a random one each time.</p>

                  {/* Prerequisites */}
                  <div className="space-y-1.5">
                    <p className="font-semibold text-gray-700 dark:text-[#C9D1D9]">Prerequisites</p>
                    <ul className="space-y-1 list-disc list-inside">
                      <li>A Cloudflare account (free)</li>
                      <li>A domain added to Cloudflare (nameservers pointing to CF)</li>
                      <li><code className="font-mono bg-gray-100 dark:bg-[#0F1117] px-1 py-0.5 rounded">cloudflared</code> installed — <code className="font-mono bg-gray-100 dark:bg-[#0F1117] px-1 py-0.5 rounded">brew install cloudflared</code></li>
                    </ul>
                  </div>

                  {/* Step 1 */}
                  <div className="space-y-1.5">
                    <p className="font-semibold text-gray-700 dark:text-[#C9D1D9]">Step 1 — Authenticate</p>
                    <p>Opens a browser to log in to your Cloudflare account and saves credentials to <code className="font-mono bg-gray-100 dark:bg-[#0F1117] px-1 py-0.5 rounded">~/.cloudflared/cert.pem</code>.</p>
                    <pre className="bg-gray-100 dark:bg-[#0F1117] rounded-lg px-3 py-2 font-mono text-[11px] overflow-x-auto">cloudflared tunnel login</pre>
                  </div>

                  {/* Step 2 */}
                  <div className="space-y-1.5">
                    <p className="font-semibold text-gray-700 dark:text-[#C9D1D9]">Step 2 — Create the tunnel</p>
                    <p>Creates a named tunnel and saves a credentials JSON to <code className="font-mono bg-gray-100 dark:bg-[#0F1117] px-1 py-0.5 rounded">~/.cloudflared/</code>. Note the tunnel UUID printed.</p>
                    <pre className="bg-gray-100 dark:bg-[#0F1117] rounded-lg px-3 py-2 font-mono text-[11px] overflow-x-auto">cloudflared tunnel create daily-planner</pre>
                  </div>

                  {/* Step 3 */}
                  <div className="space-y-1.5">
                    <p className="font-semibold text-gray-700 dark:text-[#C9D1D9]">Step 3 — Create a DNS record</p>
                    <p>Routes your subdomain to the tunnel. The CNAME is created automatically in Cloudflare DNS.</p>
                    <pre className="bg-gray-100 dark:bg-[#0F1117] rounded-lg px-3 py-2 font-mono text-[11px] overflow-x-auto">cloudflared tunnel route dns daily-planner planner.yourdomain.com</pre>
                  </div>

                  {/* Step 4 */}
                  <div className="space-y-1.5">
                    <p className="font-semibold text-gray-700 dark:text-[#C9D1D9]">Step 4 — Create config file</p>
                    <p>Create <code className="font-mono bg-gray-100 dark:bg-[#0F1117] px-1 py-0.5 rounded">~/.cloudflared/config.yml</code> with the following content (replace the UUID and hostname):</p>
                    <pre className="bg-gray-100 dark:bg-[#0F1117] rounded-lg px-3 py-2 font-mono text-[11px] overflow-x-auto leading-relaxed">{`tunnel: daily-planner
credentials-file: /Users/YOUR_USER/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: planner.yourdomain.com
    service: http://localhost:7734
  - service: http_status:404`}</pre>
                    <p>Find your UUID by running: <code className="font-mono bg-gray-100 dark:bg-[#0F1117] px-1 py-0.5 rounded">cloudflared tunnel list</code></p>
                  </div>

                  {/* Step 5 */}
                  <div className="space-y-1.5">
                    <p className="font-semibold text-gray-700 dark:text-[#C9D1D9]">Step 5 — Fill in the settings</p>
                    <ul className="space-y-1 list-disc list-inside">
                      <li><strong className="text-gray-700 dark:text-[#C9D1D9]">Tunnel Name:</strong> <code className="font-mono bg-gray-100 dark:bg-[#0F1117] px-1 py-0.5 rounded">daily-planner</code></li>
                      <li><strong className="text-gray-700 dark:text-[#C9D1D9]">Tunnel Hostname:</strong> <code className="font-mono bg-gray-100 dark:bg-[#0F1117] px-1 py-0.5 rounded">planner.yourdomain.com</code></li>
                    </ul>
                  </div>

                  {/* Step 6 */}
                  <div className="space-y-1.5">
                    <p className="font-semibold text-gray-700 dark:text-[#C9D1D9]">Step 6 — Start the tunnel</p>
                    <p>Go to the <strong className="text-gray-700 dark:text-[#C9D1D9]">Remote Access</strong> page and click <strong className="text-gray-700 dark:text-[#C9D1D9]">Start Tunnel</strong>. The URL will be permanent across restarts.</p>
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
                    <strong>Tip:</strong> Leave both fields blank to use a random <code className="font-mono">trycloudflare.com</code> URL without any setup.
                  </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end px-4 py-3 border-t border-gray-100 dark:border-[#21262D] shrink-0">
                  <button
                    onClick={() => setShowTunnelGuide(false)}
                    className="text-xs px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition-colors cursor-pointer"
                  >
                    Got it
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Global AI Prompt */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <MessageSquare size={14} className="text-gray-500 dark:text-[#8B949E]" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">Global AI Prompt</h2>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-400 dark:text-[#484F58]">
              Prepended to every AI provider call across the app. Use it to set a persistent system context or persona.
            </p>
            <textarea
              value={draft.promptDraft}
              onChange={(e) => setDraft((prev) => ({ ...prev, promptDraft: e.target.value }))}
              rows={5}
              placeholder="e.g. You are working in a TypeScript monorepo. Always prefer functional patterns and avoid classes unless absolutely necessary."
              className={`w-full resize-none ${inputClass}`}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 dark:text-[#484F58]">{draft.promptDraft.length} chars</span>
              <Button
                variant="secondary"
                size="sm"
                icon={<Save size={12} />}
                onClick={handleSaveGlobalPrompt}
                loading={promptSaving}
              >
                Save
              </Button>
            </div>
          </div>
        </section>

        {/* Auto Backup */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <HardDrive size={14} className="text-gray-500 dark:text-[#8B949E]" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">Auto Backup</h2>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw size={12} className={backupLoading ? 'animate-spin' : ''} />}
                onClick={loadBackupData}
              >
                Refresh
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Shield size={12} />}
                onClick={handleBackupNow}
                loading={backupNowLoading}
              >
                Backup Now
              </Button>
            </div>
          </div>
          <div className="p-4 space-y-4">
            {backupSettings && (
              <>
                {/* Enable toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-[#8B949E]">Enable Auto Backup</p>
                    <p className="text-xs text-gray-400 dark:text-[#484F58] mt-0.5">Automatically backup the database on a schedule</p>
                  </div>
                  <button
                    onClick={() => handleSaveBackupSettings({ enabled: !backupSettings.enabled })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${backupSettings.enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-[#30363D]'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${backupSettings.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                <div className="border-t border-gray-100 dark:border-[#21262D]" />

                {/* Interval */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-[#8B949E]">Backup Interval</p>
                    <p className="text-xs text-gray-400 dark:text-[#484F58] mt-0.5">Minutes between automatic backups</p>
                  </div>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={backupSettings.interval_min}
                    onChange={(e) => setBackupSettingsState((p) => p ? { ...p, interval_min: Number(e.target.value) } : p)}
                    onBlur={() => handleSaveBackupSettings({ interval_min: backupSettings.interval_min })}
                    className={`w-20 ${inputClass}`}
                  />
                </div>

                <div className="border-t border-gray-100 dark:border-[#21262D]" />

                {/* Max sessions */}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-[#8B949E]">Max Sessions</p>
                    <p className="text-xs text-gray-400 dark:text-[#484F58] mt-0.5">How many backup snapshots to keep</p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={backupSettings.max_sessions}
                    onChange={(e) => setBackupSettingsState((p) => p ? { ...p, max_sessions: Number(e.target.value) } : p)}
                    onBlur={() => handleSaveBackupSettings({ max_sessions: backupSettings.max_sessions })}
                    className={`w-20 ${inputClass}`}
                  />
                </div>
              </>
            )}

            {/* Sessions header */}
            <div className="border-t border-gray-100 dark:border-[#21262D] pt-3">
              <button
                className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-[#8B949E] cursor-pointer hover:text-gray-700 dark:hover:text-[#E6EDF3] transition-colors w-full"
                onClick={() => setShowSessions((p) => !p)}
              >
                {showSessions ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Backup Sessions ({backupSessions.length})
                {backupSessions.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ShieldCheck size={11} />}
                    onClick={(e) => { e.stopPropagation(); handleVerifyAll(); }}
                    loading={verifyAllLoading}
                    className="ml-auto text-[10px]"
                  >
                    Verify All
                  </Button>
                )}
              </button>

              {showSessions && (
                <div className="mt-2 space-y-1.5">
                  {backupSessions.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-[#484F58] py-2 text-center">No backup sessions yet</p>
                  )}
                  {backupSessions.map((session) => {
                    const action = sessionActions[session.id];
                    const statusIcon = session.integrity_status === 'verified'
                      ? <ShieldCheck size={12} className="text-green-400 shrink-0" />
                      : session.integrity_status === 'corrupted'
                        ? <ShieldX size={12} className="text-red-400 shrink-0" />
                        : <Shield size={12} className="text-gray-400 shrink-0" />;
                    const statusColor = session.integrity_status === 'verified'
                      ? 'text-green-400'
                      : session.integrity_status === 'corrupted'
                        ? 'text-red-400'
                        : 'text-gray-400';
                    const date = new Date(session.created_at).toLocaleString();
                    const sizekb = (session.backup_size / 1024).toFixed(1);

                    return (
                      <div
                        key={session.id}
                        className="rounded-lg border border-gray-100 dark:border-[#21262D] bg-gray-50 dark:bg-[#0F1117] p-2.5 flex items-center gap-2 text-xs"
                      >
                        {statusIcon}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-gray-700 dark:text-[#E6EDF3] font-mono truncate">{date}</span>
                            <span className={`${statusColor} uppercase text-[10px] font-semibold`}>{session.integrity_status}</span>
                          </div>
                          <div className="text-gray-400 dark:text-[#484F58] mt-0.5">
                            {session.item_count} items · {sizekb} KB · v{session.schema_version}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<ShieldCheck size={11} />}
                            onClick={() => handleVerifySession(session.id)}
                            loading={action === 'verifying'}
                            disabled={!!action}
                            className="text-[10px] px-1.5"
                          >
                            Verify
                          </Button>
                          {session.integrity_status !== 'corrupted' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<Upload size={11} />}
                              onClick={() => setRestoreSessionId(session.id)}
                              loading={action === 'restoring'}
                              disabled={!!action}
                              className="text-[10px] px-1.5"
                            >
                              Restore
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 size={11} className="text-red-400" />}
                            onClick={() => handleDeleteSession(session.id)}
                            loading={action === 'deleting'}
                            disabled={!!action}
                            className="text-[10px] px-1.5 text-red-400"
                          >
                            Del
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Data Management */}
        <section className={sectionClass}>
          <div className={sectionHeaderClass}>
            <Database size={14} className="text-gray-500 dark:text-[#8B949E]" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">Data Management</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-[#8B949E]">Backup</p>
                <p className="text-xs text-gray-400 dark:text-[#484F58] mt-0.5">Export all data to a JSON file</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<Database size={12} />}
                onClick={handleBackup}
                loading={dataOpLoading}
              >
                Backup
              </Button>
            </div>

            <div className="border-t border-gray-100 dark:border-[#21262D]" />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-[#8B949E]">Restore</p>
                <p className="text-xs text-gray-400 dark:text-[#484F58] mt-0.5">Replace all data from a backup file</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<Upload size={12} />}
                onClick={() => setShowRestoreConfirm(true)}
                loading={dataOpLoading}
              >
                Restore
              </Button>
            </div>

            <div className="border-t border-gray-100 dark:border-[#21262D]" />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-red-400">Reset App</p>
                <p className="text-xs text-gray-400 dark:text-[#484F58] mt-0.5">Wipe all data — cannot be undone</p>
              </div>
              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={dataOpLoading}
                className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="flex items-center gap-1.5">
                  <RotateCcw size={11} />
                  Reset
                </span>
              </button>
            </div>
          </div>
        </section>
      </div>

      <ConfirmModal
        open={!!restoreSessionId}
        title="Restore from Backup Session"
        description="This will replace ALL current data with this backup snapshot. This cannot be undone."
        confirmLabel="Restore"
        variant="warning"
        onConfirm={handleRestoreSession}
        onCancel={() => setRestoreSessionId(null)}
      />

      <ConfirmModal
        open={showRestoreConfirm}
        title="Restore from Backup"
        description="This will replace ALL current data with the backup. This cannot be undone."
        confirmLabel="Choose File & Restore"
        variant="warning"
        onConfirm={handleRestore}
        onCancel={() => setShowRestoreConfirm(false)}
      />

      <ConfirmModal
        open={showResetConfirm}
        title="Reset App Data"
        description="This will permanently delete all tasks and focus sessions. This cannot be undone."
        confirmLabel="Reset"
        variant="danger"
        requireTyped="RESET"
        checkboxes={[
          { id: 'keep_settings', label: 'Keep settings (timezone, schedule)', defaultChecked: true },
          { id: 'keep_builtin_templates', label: 'Keep built-in prompt templates', defaultChecked: true },
        ]}
        onConfirm={handleReset}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
};
