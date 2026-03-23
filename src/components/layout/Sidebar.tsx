import React, { useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Zap, MessageSquare, BarChart2, FolderOpen,
  Settings, FileText, Wifi, History, MoreHorizontal, X,
} from 'lucide-react';
import { useMobileStore } from '../../stores/mobileStore';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', shortcut: '⌘1' },
  { to: '/prompt', icon: MessageSquare, label: 'Prompt', shortcut: '⌘2' },
  { to: '/templates', icon: FileText, label: 'Templates', shortcut: '⌘3' },
  { to: '/history', icon: History, label: 'History', shortcut: '⌘4' },
  { to: '/reports', icon: BarChart2, label: 'Reports', shortcut: '⌘5' },
  { to: '/projects', icon: FolderOpen, label: 'Projects', shortcut: '⌘6' },
  { to: '/remote-access', icon: Wifi, label: 'Remote', shortcut: '⌘7' },
  { to: '/settings', icon: Settings, label: 'Settings', shortcut: '⌘,' },
];

// Mobile bottom bar shows top 4 + "More" menu for the rest
const PRIMARY_COUNT = 4;

const DesktopSidebar: React.FC = () => (
  <aside className="w-14 flex flex-col items-center py-4 gap-1 bg-[#F8FAFC] border-r border-[#E2E8F0] dark:bg-[#0F172A] dark:border-[#1E293B] shrink-0">
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

const MobileBottomBar: React.FC = () => {
  const { moreMenuOpen, setMoreMenuOpen } = useMobileStore();
  const location = useLocation();
  const menuRef = useRef<HTMLDivElement>(null);

  const primaryItems = navItems.slice(0, PRIMARY_COUNT);
  const secondaryItems = navItems.slice(PRIMARY_COUNT);

  const isSecondaryActive = secondaryItems.some((item) => {
    if (item.to === '/') return location.pathname === '/';
    return location.pathname.startsWith(item.to);
  });

  // Close "More" menu when navigating
  useEffect(() => {
    setMoreMenuOpen(false);
  }, [location.pathname]);

  // Close on outside click
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreMenuOpen]);

  return (
    <>
      {/* Overlay for "More" menu */}
      {moreMenuOpen && (
        <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setMoreMenuOpen(false)} />
      )}

      {/* "More" popup menu */}
      {moreMenuOpen && (
        <div
          ref={menuRef}
          className="fixed bottom-[72px] right-3 z-50 rounded-2xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] shadow-lg py-2 min-w-[200px]"
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-[#21262D]">
            <span className="text-sm font-semibold text-gray-900 dark:text-[#E6EDF3]">More</span>
            <button
              onClick={() => setMoreMenuOpen(false)}
              className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
          {secondaryItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 min-h-[48px] text-sm transition-colors cursor-pointer
                ${isActive
                  ? 'text-[#2563EB] bg-blue-50 dark:text-[#7DD3FC] dark:bg-[rgba(125,211,252,0.08)]'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-[#94A3B8] dark:hover:bg-[#1E293B]'
                }`
              }
            >
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      )}

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-gray-200 dark:bg-[#0F172A]/95 dark:border-[#1E293B] safe-area-bottom">
        <div className="flex items-stretch justify-around px-1">
          {primaryItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 py-2 px-2 min-h-[64px] min-w-[64px] flex-1 transition-colors cursor-pointer
                ${isActive
                  ? 'text-[#2563EB] dark:text-[#7DD3FC]'
                  : 'text-[#94A3B8] dark:text-[#64748B]'
                }`
              }
            >
              <Icon size={22} />
              <span className="text-[11px] font-medium leading-none">{label}</span>
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-2 min-h-[64px] min-w-[64px] flex-1 transition-colors cursor-pointer
              ${isSecondaryActive || moreMenuOpen
                ? 'text-[#2563EB] dark:text-[#7DD3FC]'
                : 'text-[#94A3B8] dark:text-[#64748B]'
              }`}
          >
            <MoreHorizontal size={22} />
            <span className="text-[11px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>
    </>
  );
};

export const Sidebar: React.FC = () => {
  const { mobileMode } = useMobileStore();
  return mobileMode ? <MobileBottomBar /> : <DesktopSidebar />;
};
