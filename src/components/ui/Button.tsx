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
  // Solid accent blue — macOS-style primary
  primary:
    'bg-[#0071E3] hover:bg-[#0077ED] active:bg-[#005BBB] text-white border-transparent shadow-[0_1px_3px_rgba(0,113,227,0.3)]',
  // White/surface with subtle border
  secondary:
    'bg-white hover:bg-[#F5F5F7] active:bg-[#E8E8ED] text-[#1D1D1F] border-[#D2D2D7] dark:bg-[#3A3A3C] dark:hover:bg-[#48484A] dark:active:bg-[#48484A] dark:text-[#F5F5F7] dark:border-[#48484A]',
  // No background, text color only
  ghost:
    'bg-transparent hover:bg-[#F5F5F7] active:bg-[#E8E8ED] text-[#6E6E73] hover:text-[#1D1D1F] border-transparent dark:hover:bg-[#3A3A3C] dark:text-[#AEAEB2] dark:hover:text-[#F5F5F7]',
  // Soft red
  danger:
    'bg-[#FFEEEC] hover:bg-[#FFD9D6] active:bg-[#FFBFBA] text-[#FF3B30] border-[#FFD9D6] dark:bg-[rgba(255,59,48,0.12)] dark:hover:bg-[rgba(255,59,48,0.20)] dark:text-[#FF6961] dark:border-[rgba(255,59,48,0.25)]',
  // Soft green
  success:
    'bg-[#E8F9EC] hover:bg-[#D0F5D8] active:bg-[#B8EFC2] text-[#34C759] border-[#D0F5D8] dark:bg-[rgba(52,199,89,0.12)] dark:hover:bg-[rgba(52,199,89,0.20)] dark:text-[#30D158] dark:border-[rgba(52,199,89,0.25)]',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5 min-h-[28px]',
  md: 'px-3.5 py-2 text-sm gap-2 min-h-[36px]',
  lg: 'px-5 py-2.5 text-base gap-2.5 min-h-[40px]',
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
        inline-flex items-center justify-center font-medium rounded-[8px] border
        transition-all duration-150 cursor-pointer
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
