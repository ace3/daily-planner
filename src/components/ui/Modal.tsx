import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, size = 'md' }) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Frosted glass overlay */}
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-[8px]"
        onClick={onClose}
      />

      {/* Modal card */}
      <div
        className={`relative bg-white dark:bg-[#2C2C2E] border border-[#E8E8ED] dark:border-[#3A3A3C] rounded-[14px] shadow-mac-modal w-full ${sizeClasses[size]} max-h-[90vh] overflow-y-auto mac-modal-animate`}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E8ED] dark:border-[#3A3A3C]">
            <h2 className="text-[15px] font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">{title}</h2>
            <button
              onClick={onClose}
              className="text-[#AEAEB2] hover:text-[#6E6E73] dark:text-[#6E6E73] dark:hover:text-[#AEAEB2] transition-colors duration-150 cursor-pointer p-1.5 rounded-[6px] hover:bg-[#F5F5F7] dark:hover:bg-[#3A3A3C]"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};
