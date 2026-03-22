import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

let addToastFn: ((type: ToastType, message: string) => void) | null = null;

export const toast = {
  success: (msg: string) => addToastFn?.('success', msg),
  error: (msg: string) => addToastFn?.('error', msg),
  warning: (msg: string) => addToastFn?.('warning', msg),
  info: (msg: string) => addToastFn?.('info', msg),
};

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={16} className="text-emerald-400" />,
  error: <XCircle size={16} className="text-red-400" />,
  warning: <AlertCircle size={16} className="text-amber-400" />,
  info: <Info size={16} className="text-blue-400" />,
};

const bgClasses: Record<ToastType, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10',
  error: 'border-red-500/30 bg-red-500/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
  info: 'border-blue-500/30 bg-blue-500/10',
};

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    addToastFn = (type, message) => {
      const id = Date.now().toString();
      setToasts((prev) => [...prev, { id, type, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    };
    return () => { addToastFn = null; };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-lg border text-sm text-[#E6EDF3] shadow-lg pointer-events-auto backdrop-blur-sm ${bgClasses[t.type]}`}
        >
          {icons[t.type]}
          <span>{t.message}</span>
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="ml-1 text-[#8B949E] hover:text-[#E6EDF3] cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
};
