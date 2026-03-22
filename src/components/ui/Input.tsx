import React from 'react';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'suffix'> {
  label?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({ label, error, prefix, suffix, className = '', ...props }) => {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-[#8B949E] uppercase tracking-wide">{label}</label>}
      <div className="relative flex items-center">
        {prefix && <span className="absolute left-3 text-[#8B949E]">{prefix}</span>}
        <input
          {...props}
          className={`
            w-full bg-[#161B22] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm
            placeholder-[#484F58] outline-none
            focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
            transition-colors duration-150
            ${prefix ? 'pl-9' : 'pl-3'} ${suffix ? 'pr-9' : 'pr-3'} py-2
            ${error ? 'border-red-500/50 focus:border-red-500' : ''}
            ${className}
          `}
        />
        {suffix && <span className="absolute right-3 text-[#8B949E]">{suffix}</span>}
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
};

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea: React.FC<TextareaProps> = ({ label, error, className = '', ...props }) => {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-[#8B949E] uppercase tracking-wide">{label}</label>}
      <textarea
        {...props}
        className={`
          w-full bg-[#161B22] border border-[#30363D] rounded-lg text-[#E6EDF3] text-sm
          placeholder-[#484F58] outline-none resize-none
          focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
          transition-colors duration-150 px-3 py-2
          ${error ? 'border-red-500/50' : ''}
          ${className}
        `}
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
};
