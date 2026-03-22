import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Zap, MessageSquare, BarChart2, FolderOpen, Settings, FileText } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', shortcut: '⌘1' },
  { to: '/prompt', icon: MessageSquare, label: 'Prompt', shortcut: '⌘2' },
  { to: '/templates', icon: FileText, label: 'Templates', shortcut: '⌘3' },
  { to: '/reports', icon: BarChart2, label: 'Reports', shortcut: '⌘4' },
  { to: '/projects', icon: FolderOpen, label: 'Projects', shortcut: '⌘5' },
  { to: '/settings', icon: Settings, label: 'Settings', shortcut: '⌘,' },
];

export const Sidebar: React.FC = () => {
  return (
    <aside className="w-14 flex flex-col items-center py-4 gap-1 bg-white border-r border-gray-100 dark:bg-[#0F1117] dark:border-[#21262D] shrink-0">
      {/* Logo */}
      <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center mb-3">
        <Zap size={16} className="text-white" />
      </div>

      <div className="flex-1 flex flex-col items-center gap-1 w-full px-2">
        {navItems.map(({ to, icon: Icon, label, shortcut }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={`${label} (${shortcut})`}
            className={({ isActive }) =>
              `w-full flex items-center justify-center p-2.5 rounded-lg transition-colors duration-150 cursor-pointer group relative
              ${isActive
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-[#484F58] dark:hover:text-[#8B949E] dark:hover:bg-[#161B22]'
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
