import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Clock, Database, RotateCcw, Upload, MessageSquare, Save, AlertTriangle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useSettingsStore } from '../stores/settingsStore';
import { useTaskStore } from '../stores/taskStore';
import { useReportStore } from '../stores/reportStore';
import { backupData, restoreData, resetAppData, checkCopilotCliAvailability } from '../lib/tauri';
import { toast } from '../components/ui/Toast';
import { useSessionDraftState } from '../hooks/useSessionDraftState';

interface SettingsDraft {
  timezone_offset: string;
  session1_kickstart: string;
  planning_end: string;
  session2_start: string;
  warn_before_min: string;
  default_model_codex: string;
  default_model_claude: string;
  default_model_opencode: string;
  default_model_copilot: string;
  promptDraft: string;
  initializedFromSettings: boolean;
  initializedPrompt: boolean;
}

export const SettingsPage: React.FC = () => {
  const { settings, fetchSettings, updateSetting, globalPrompt, fetchGlobalPrompt, setGlobalPrompt } = useSettingsStore();
  const { fetchTasks, activeDate } = useTaskStore();
  const { fetchRecentReports } = useReportStore();
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [dataOpLoading, setDataOpLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [copilotCliAvailable, setCopilotCliAvailable] = useState<boolean | null>(null);
  const [draft, setDraft] = useSessionDraftState<SettingsDraft>('settings-page-draft', {
    timezone_offset: '',
    session1_kickstart: '',
    planning_end: '',
    session2_start: '',
    warn_before_min: '',
    default_model_codex: '',
    default_model_claude: '',
    default_model_opencode: '',
    default_model_copilot: '',
    promptDraft: '',
    initializedFromSettings: false,
    initializedPrompt: false,
  });

  useEffect(() => {
    fetchSettings();
    fetchGlobalPrompt();
    checkCopilotCliAvailability()
      .then((status) => setCopilotCliAvailable(status.available))
      .catch(() => setCopilotCliAvailable(false));
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
      session1_kickstart: settings.session1_kickstart,
      planning_end: settings.planning_end,
      session2_start: settings.session2_start,
      warn_before_min: String(settings.warn_before_min),
      default_model_codex: settings.default_model_codex,
      default_model_claude: settings.default_model_claude,
      default_model_opencode: settings.default_model_opencode,
      default_model_copilot: settings.default_model_copilot,
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
      await Promise.all([fetchSettings(), fetchTasks(activeDate), fetchRecentReports(30)]);
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
      await Promise.all([fetchSettings(), fetchTasks(activeDate), fetchRecentReports(30)]);
      toast.success('App data cleared');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDataOpLoading(false);
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

            {/* Time settings */}
            {[
              { key: 'session1_kickstart', label: 'Morning Kickstart', desc: 'When to start prompting (5-hour session begins)' },
              { key: 'planning_end', label: 'Switch to Claude Code', desc: 'End of planning phase — switch to development' },
              { key: 'session2_start', label: 'Session Reset', desc: 'When Claude Pro session resets (5-hour cycle)' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="space-y-1.5">
                <div>
                  <label className={labelClass}>{label}</label>
                  <p className="text-xs text-gray-400 dark:text-[#484F58] mt-0.5">{desc}</p>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="time"
                    value={draft[key as 'session1_kickstart' | 'planning_end' | 'session2_start']}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    onBlur={(e) => handleSave(key, e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
            ))}

            {/* Warning time */}
            <div className="space-y-1.5">
              <label className={labelClass}>Warning Before Reset (minutes)</label>
              <input
                type="number"
                value={draft.warn_before_min}
                min={5}
                max={60}
                onChange={(e) => setDraft((prev) => ({ ...prev, warn_before_min: e.target.value }))}
                onBlur={(e) => handleSave('warn_before_min', e.target.value)}
                className={`w-24 ${inputClass}`}
              />
            </div>
          </div>
        </section>

        {/* Model */}
        <section className={sectionClass}>
          <div className="px-4 py-3 border-b border-gray-200 dark:border-[#30363D]">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">AI Provider</h2>
          </div>
          <div className="p-4 space-y-3">
            <select
              value={settings.ai_provider}
              onChange={(e) => handleSave('ai_provider', e.target.value)}
              className={`w-full ${inputClass} cursor-pointer`}
            >
              <option value="claude">Claude CLI</option>
              <option value="opencode">OpenCode CLI</option>
              <option value="copilot_cli">GitHub Copilot CLI (gh copilot)</option>
            </select>
            <p className="text-xs text-gray-400 dark:text-[#484F58]">
              Used for prompt improvements, queued runs, and AI report reflections.
            </p>
            {settings.ai_provider === 'copilot_cli' && copilotCliAvailable === false && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400 flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong>Copilot CLI unavailable.</strong> Install/authenticate with <code>gh</code> and <code>gh copilot</code> before using this provider.
                </span>
              </div>
            )}
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
                  'claude-sonnet-4-5',
                  'claude-haiku-4-5',
                  'claude-opus-4-5',
                  'claude-sonnet-4',
                  'gemini-3-pro',
                  'gpt-5.3-codex',
                  'gpt-5.2-codex',
                  'gpt-5.2',
                  'gpt-5.1-codex-max',
                  'gpt-5.1-codex',
                  'gpt-5.1',
                  'gpt-5.4-mini',
                  'gpt-5.1-codex-mini',
                  'gpt-5-mini',
                  'gpt-4.1',
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
        description="This will permanently delete all tasks, focus sessions, and reports. This cannot be undone."
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
