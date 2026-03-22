import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface CheckboxOption {
  id: string;
  label: string;
  defaultChecked: boolean;
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant: 'danger' | 'warning';
  requireTyped?: string;
  checkboxes?: CheckboxOption[];
  onConfirm: (checkboxValues?: Record<string, boolean>) => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel,
  variant,
  requireTyped,
  checkboxes,
  onConfirm,
  onCancel,
}) => {
  const [typedValue, setTypedValue] = useState('');
  const [checkValues, setCheckValues] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTypedValue('');
      const initial: Record<string, boolean> = {};
      checkboxes?.forEach((c) => { initial[c.id] = c.defaultChecked; });
      setCheckValues(initial);
      if (requireTyped) setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmDisabled = requireTyped ? typedValue !== requireTyped : false;
  const iconColor = variant === 'danger' ? 'text-red-400' : 'text-amber-400';
  const confirmBtnClass = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-600'
    : 'bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-sm mx-4 rounded-xl border border-[#30363D] bg-[#161B22] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className={iconColor} />
            <h2 className="text-sm font-semibold text-[#E6EDF3]">{title}</h2>
          </div>
          <button onClick={onCancel} className="text-[#484F58] hover:text-[#8B949E] cursor-pointer transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-[#8B949E]">{description}</p>

          {checkboxes && checkboxes.length > 0 && (
            <div className="space-y-2">
              {checkboxes.map((c) => (
                <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkValues[c.id] ?? c.defaultChecked}
                    onChange={(e) => setCheckValues((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                    className="rounded border-[#30363D] bg-[#0F1117] text-blue-500 cursor-pointer"
                  />
                  <span className="text-xs text-[#8B949E]">{c.label}</span>
                </label>
              ))}
            </div>
          )}

          {requireTyped && (
            <div className="space-y-1.5">
              <p className="text-xs text-[#484F58]">
                Type{' '}
                <span className="font-mono text-[#8B949E] bg-[#0F1117] px-1 py-0.5 rounded">
                  {requireTyped}
                </span>{' '}
                to confirm
              </p>
              <input
                ref={inputRef}
                type="text"
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                placeholder={requireTyped}
                className="w-full bg-[#0F1117] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm placeholder-[#484F58] outline-none focus:border-red-500/50 transition-colors px-3 py-2"
              />
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <button
              onClick={onCancel}
              className="text-xs text-[#8B949E] hover:text-[#E6EDF3] px-3 py-2 rounded-lg border border-[#30363D] hover:border-[#484F58] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => !confirmDisabled && onConfirm(checkboxes ? checkValues : undefined)}
              disabled={confirmDisabled}
              className={`text-xs text-white px-3 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${confirmBtnClass}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
