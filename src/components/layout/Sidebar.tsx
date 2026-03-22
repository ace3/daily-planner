import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Zap, MessageSquare, BarChart2, Settings } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', shortcut: '⌘1' },
  { to: '/focus', icon: Zap, label: 'Focus', shortcut: '⌘2' },
  { to: '/prompt', icon: MessageSquare, label: 'Prompt', shortcut: '⌘3' },
  { to: '/reports', icon: BarChart2, label: 'Reports', shortcut: '⌘4' },
  { to: '/settings', icon: Settings, label: 'Settings', shortcut: '⌘,' },
];

export const Sidebar: React.FC = () => {
  return (
    <aside className="w-14 flex flex-col items-center py-4 gap-1 bg-[#0F1117] border-r border-[#21262D] shrink-0">
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
                : 'text-[#484F58] hover:text-[#8B949E] hover:bg-[#161B22]'
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
