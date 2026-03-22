import React from 'react';

type BadgeVariant = 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'purple';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  blue: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  red: 'bg-red-500/15 text-red-400 border-red-500/20',
  gray: 'bg-[#21262D] text-[#8B949E] border-[#30363D]',
  purple: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
};

export const Badge: React.FC<BadgeProps> = ({ variant = 'gray', children, className = '' }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${variantClasses[variant]} ${className}`}>
    {children}
  </span>
);
