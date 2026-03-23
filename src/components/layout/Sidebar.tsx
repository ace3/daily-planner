import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Zap, MessageSquare, BarChart2, FolderOpen, Settings, FileText, Wifi, History } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', shortcut: '⌘1' },
  { to: '/prompt', icon: MessageSquare, label: 'Prompt', shortcut: '⌘2' },
  { to: '/templates', icon: FileText, label: 'Templates', shortcut: '⌘3' },
  { to: '/history', icon: History, label: 'History', shortcut: '⌘4' },
  { to: '/reports', icon: BarChart2, label: 'Reports', shortcut: '⌘5' },
  { to: '/projects', icon: FolderOpen, label: 'Projects', shortcut: '⌘6' },
  { to: '/remote-access', icon: Wifi, label: 'Remote Access', shortcut: '⌘7' },
  { to: '/settings', icon: Settings, label: 'Settings', shortcut: '⌘,' },
];

export const Sidebar: React.FC = () => {
  return (
    <aside className="w-14 flex flex-col items-center py-4 gap-1 bg-[#F8FAFC] border-r border-[#E2E8F0] dark:bg-[#0F172A] dark:border-[#1E293B] shrink-0">
      {/* Logo */}
      <div className="w-8 h-8 rounded-[10px] bg-[#60A5FA] dark:bg-[#7DD3FC] flex items-center justify-center mb-3 shadow-vegr-sm">
        <Zap size={16} className="text-white dark:text-[#111827]" />
      </div>

      <div className="flex-1 flex flex-col items-center gap-0.5 w-full px-2">
        {navItems.map(({ to, icon: Icon, label, shortcut }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={`${label} (${shortcut})`}
            className={({ isActive }) =>
              `w-full flex items-center justify-center p-2.5 rounded-[10px] transition-colors duration-150 cursor-pointer group relative
              ${isActive
                ? 'bg-[#DBEAFE] text-[#2563EB] dark:bg-[rgba(125,211,252,0.16)] dark:text-[#7DD3FC]'
                : 'text-[#64748B] hover:text-[#111827] hover:bg-[#F1F5F9] dark:text-[#94A3B8] dark:hover:text-[#E5E7EB] dark:hover:bg-[#1E293B]'
              }`
            }
          >
            <Icon size={18} />
          </NavLink>
        ))}
      </div>
    </aside>
  );
};
