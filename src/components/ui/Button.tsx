import React from 'react';
import { useMobileStore } from '../../stores/mobileStore';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-blue-500 hover:bg-blue-600 text-white border-transparent',
  secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200 dark:bg-[#1C2128] dark:hover:bg-[#2D333B] dark:text-[#E6EDF3] dark:border-[#30363D]',
  ghost: 'bg-transparent hover:bg-gray-100 text-gray-500 hover:text-gray-700 border-transparent dark:hover:bg-[#1C2128] dark:text-[#8B949E] dark:hover:text-[#E6EDF3]',
  danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30',
  success: 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1.5',
  md: 'px-3.5 py-1.5 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2.5',
};

const mobileSizeClasses: Record<Size, string> = {
  sm: 'px-3.5 py-2 text-sm gap-2 min-h-[44px]',
  md: 'px-4 py-2.5 text-base gap-2.5 min-h-[44px]',
  lg: 'px-5 py-3 text-lg gap-3 min-h-[48px]',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  className = '',
  ...props
}) => {
  const { mobileMode } = useMobileStore();
  const sizes = mobileMode ? mobileSizeClasses : sizeClasses;

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center font-medium rounded-lg border
        transition-colors duration-150 cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantClasses[variant]} ${sizes[size]} ${className}
      `}
    >
      {loading ? (
        <svg className={`animate-spin ${mobileMode ? 'w-4 h-4' : 'w-3.5 h-3.5'}`} viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : icon}
      {children}
    </button>
  );
};
