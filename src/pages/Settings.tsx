import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Key, Bell, Clock, Save, Search, Database, RotateCcw, Upload } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useSettingsStore } from '../stores/settingsStore';
import { useTaskStore } from '../stores/taskStore';
import { useReportStore } from '../stores/reportStore';
import { detectClaudeToken, backupData, restoreData, resetAppData } from '../lib/tauri';
import { toast } from '../components/ui/Toast';

export const SettingsPage: React.FC = () => {
  const { settings, fetchSettings, updateSetting, updateClaudeToken } = useSettingsStore();
  const { fetchTasks, activeDate } = useTaskStore();
  const { fetchRecentReports } = useReportStore();
  const [token, setToken] = useState('');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [detecting, setDetecting] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [dataOpLoading, setDataOpLoading] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  if (!settings) return <div className="flex-1 flex items-center justify-center text-[#484F58] text-sm">Loading...</div>;

  const handleSave = async (key: string, value: string) => {
    setSaving((p) => ({ ...p, [key]: true }));
    try {
      await updateSetting(key as any, value);
      toast.success('Setting saved');
    } catch {
      toast.error('Failed to save setting');
    } finally {
      setSaving((p) => ({ ...p, [key]: false }));
    }
  };

  const handleTokenSave = async () => {
    if (!token.trim()) return;
    setSaving((p) => ({ ...p, token: true }));
    try {
      await updateClaudeToken(token.trim());
      setToken('');
      toast.success('Claude token saved');
    } finally {
      setSaving((p) => ({ ...p, token: false }));
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

  const handleDetectToken = async () => {
    setDetecting(true);
    try {
      const detected = await detectClaudeToken();
      if (detected) {
        setToken(detected);
        toast.success('Token detected! Click Save to store it.');
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <SettingsIcon size={16} className="text-[#8B949E]" />
          <h1 className="text-base font-semibold text-[#E6EDF3]">Settings</h1>
        </div>

        {/* Timezone & Schedule */}
        <section className="rounded-xl border border-[#30363D] bg-[#161B22] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#30363D]">
            <Clock size={14} className="text-[#8B949E]" />
            <h2 className="text-sm font-semibold text-[#E6EDF3]">Schedule</h2>
          </div>
          <div className="p-4 space-y-4">
            {/* Timezone offset */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#8B949E] uppercase tracking-wide">
                UTC Offset (e.g. 7 for UTC+7)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  defaultValue={settings.timezone_offset}
                  min={-12}
                  max={14}
                  step={1}
                  onBlur={(e) => handleSave('timezone_offset', e.target.value)}
                  className="w-24 bg-[#161B22] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm placeholder-[#484F58] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors px-3 py-2"
                />
                <span className="text-xs text-[#484F58] self-center">
                  Currently UTC{settings.timezone_offset >= 0 ? '+' : ''}{settings.timezone_offset}
                </span>
              </div>
            </div>

            {/* Time settings */}
            {[
              { key: 'session1_kickstart', label: 'Morning Kickstart', desc: 'When to start prompting (5-hour session begins)', default: settings.session1_kickstart },
              { key: 'planning_end', label: 'Switch to Claude Code', desc: 'End of planning phase — switch to development', default: settings.planning_end },
              { key: 'session2_start', label: 'Session Reset', desc: 'When Claude Pro session resets (5-hour cycle)', default: settings.session2_start },
            ].map(({ key, label, desc, default: def }) => (
              <div key={key} className="space-y-1.5">
                <div>
                  <label className="text-xs font-medium text-[#8B949E] uppercase tracking-wide">{label}</label>
                  <p className="text-xs text-[#484F58] mt-0.5">{desc}</p>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="time"
                    defaultValue={def}
                    onBlur={(e) => handleSave(key, e.target.value)}
                    className="bg-[#161B22] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors px-3 py-2"
                  />
                </div>
              </div>
            ))}

            {/* Warning time */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#8B949E] uppercase tracking-wide">
                Warning Before Reset (minutes)
              </label>
              <input
                type="number"
                defaultValue={settings.warn_before_min}
                min={5}
                max={60}
                onBlur={(e) => handleSave('warn_before_min', e.target.value)}
                className="w-24 bg-[#161B22] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors px-3 py-2"
              />
            </div>
          </div>
        </section>

        {/* Pomodoro */}
        <section className="rounded-xl border border-[#30363D] bg-[#161B22] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#30363D]">
            <Bell size={14} className="text-[#8B949E]" />
            <h2 className="text-sm font-semibold text-[#E6EDF3]">Pomodoro</h2>
          </div>
          <div className="p-4 grid grid-cols-2 gap-4">
            {[
              { key: 'pomodoro_work_min', label: 'Work interval (min)', default: settings.pomodoro_work_min },
              { key: 'pomodoro_break_min', label: 'Break interval (min)', default: settings.pomodoro_break_min },
            ].map(({ key, label, default: def }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-xs font-medium text-[#8B949E] uppercase tracking-wide">{label}</label>
                <input
                  type="number"
                  defaultValue={def}
                  min={1}
                  max={120}
                  onBlur={(e) => handleSave(key, e.target.value)}
                  className="w-full bg-[#0F1117] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm outline-none focus:border-blue-500 transition-colors px-3 py-2"
                />
              </div>
            ))}
          </div>
        </section>

        {/* Claude Token */}
        <section className="rounded-xl border border-[#30363D] bg-[#161B22] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#30363D]">
            <Key size={14} className="text-[#8B949E]" />
            <h2 className="text-sm font-semibold text-[#E6EDF3]">Claude API Token</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <p className="text-xs text-[#8B949E]">
                Used for AI planning and end-of-day reflections. Enter your Anthropic API key or Claude Code OAuth token. Stored encrypted locally.
              </p>
            </div>
            {settings.has_claude_token && (
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                Token saved
              </div>
            )}
            <div className="flex gap-2">
              <input
                type={tokenVisible ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={settings.has_claude_token ? '••••••••••••• (saved)' : 'Paste API key or token...'}
                className="flex-1 bg-[#0F1117] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm placeholder-[#484F58] outline-none focus:border-blue-500 transition-colors px-3 py-2"
              />
              <button
                onClick={() => setTokenVisible(!tokenVisible)}
                className="text-xs text-[#484F58] hover:text-[#8B949E] cursor-pointer px-2"
              >
                {tokenVisible ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<Search size={12} />}
                onClick={handleDetectToken}
                loading={detecting}
              >
                Auto-detect
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Save size={12} />}
                onClick={handleTokenSave}
                loading={saving['token']}
                disabled={!token.trim()}
              >
                Save Token
              </Button>
            </div>
          </div>
        </section>

        {/* Model */}
        <section className="rounded-xl border border-[#30363D] bg-[#161B22] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363D]">
            <h2 className="text-sm font-semibold text-[#E6EDF3]">Claude Model</h2>
          </div>
          <div className="p-4">
            <select
              defaultValue={settings.claude_model}
              onChange={(e) => handleSave('claude_model', e.target.value)}
              className="w-full bg-[#0F1117] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm outline-none focus:border-blue-500 transition-colors px-3 py-2 cursor-pointer"
            >
              <option value="claude-sonnet-4-6">claude-sonnet-4-6 (recommended)</option>
              <option value="claude-opus-4-6">claude-opus-4-6 (most capable)</option>
              <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 (fastest)</option>
            </select>
          </div>
        </section>

        {/* Work days */}
        <section className="rounded-xl border border-[#30363D] bg-[#161B22] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363D]">
            <h2 className="text-sm font-semibold text-[#E6EDF3]">Work Days</h2>
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
                      ${active ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-[#0F1117] text-[#484F58] border border-[#21262D] hover:border-[#30363D]'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
        {/* Data Management */}
        <section className="rounded-xl border border-[#30363D] bg-[#161B22] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#30363D]">
            <Database size={14} className="text-[#8B949E]" />
            <h2 className="text-sm font-semibold text-[#E6EDF3]">Data Management</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#8B949E]">Backup</p>
                <p className="text-xs text-[#484F58] mt-0.5">Export all data to a JSON file</p>
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

            <div className="border-t border-[#21262D]" />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#8B949E]">Restore</p>
                <p className="text-xs text-[#484F58] mt-0.5">Replace all data from a backup file</p>
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

            <div className="border-t border-[#21262D]" />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-red-400">Reset App</p>
                <p className="text-xs text-[#484F58] mt-0.5">Wipe all data — cannot be undone</p>
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
        description="This will replace ALL current data with the backup. Your Claude token will be preserved. This cannot be undone."
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
          { id: 'keep_settings', label: 'Keep settings (timezone, schedule, Claude token)', defaultChecked: true },
          { id: 'keep_builtin_templates', label: 'Keep built-in prompt templates', defaultChecked: true },
        ]}
        onConfirm={handleReset}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
};
