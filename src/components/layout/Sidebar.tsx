import React, { useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Zap, FolderGit2, ListOrdered,
  Settings, FileText, Wifi, MoreHorizontal, X,
} from 'lucide-react';
import { useMobileStore } from '../../stores/mobileStore';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', shortcut: '⌘1' },
  { to: '/projects', icon: FolderGit2, label: 'Projects', shortcut: '⌘2' },
  { to: '/queue', icon: ListOrdered, label: 'Queue', shortcut: '⌘3' },
  { to: '/templates', icon: FileText, label: 'Templates', shortcut: '⌘4' },
  { to: '/remote-access', icon: Wifi, label: 'Remote Access', shortcut: '⌘5' },
  { to: '/settings', icon: Settings, label: 'Settings', shortcut: '⌘,' },
];

// Mobile bottom bar shows top 4 + "More" menu for the rest
const PRIMARY_COUNT = 4;

const DesktopSidebar: React.FC = () => (
  <aside className="w-14 flex flex-col items-center py-4 gap-1 bg-white border-r border-[#D2D2D7] dark:bg-[#2C2C2E] dark:border-[#3A3A3C] shrink-0">
    {/* App icon */}
    <div className="w-8 h-8 rounded-[10px] bg-[#0071E3] dark:bg-[#409CFF] flex items-center justify-center mb-3 shadow-mac">
      <Zap size={16} className="text-white" />
    </div>

    {/* Nav items */}
    <div className="flex-1 flex flex-col items-center gap-0.5 w-full px-2">
      {navItems.map(({ to, icon: Icon, label, shortcut }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          title={`${label} (${shortcut})`}
          className={({ isActive }) =>
            `w-full flex items-center justify-center p-2.5 rounded-[8px] transition-all duration-150 cursor-pointer
            ${isActive
              ? 'bg-[#E3F0FF] text-[#0071E3] dark:bg-[rgba(64,156,255,0.15)] dark:text-[#409CFF]'
              : 'text-[#6E6E73] hover:text-[#1D1D1F] hover:bg-[#F5F5F7] dark:text-[#6E6E73] dark:hover:text-[#F5F5F7] dark:hover:bg-[#3A3A3C]'
            }`
          }
        >
          <Icon size={18} strokeWidth={1.5} />
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
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40" onClick={() => setMoreMenuOpen(false)} />
      )}

      {/* "More" popup menu — macOS popover style */}
      {moreMenuOpen && (
        <div
          ref={menuRef}
          className="fixed bottom-[72px] right-3 z-50 rounded-[14px] border border-[#D2D2D7] bg-white/90 backdrop-blur-md dark:border-[#3A3A3C] dark:bg-[#2C2C2E]/90 shadow-mac-modal py-2 min-w-[200px]"
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#E8E8ED] dark:border-[#3A3A3C]">
            <span className="text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">More</span>
            <button
              onClick={() => setMoreMenuOpen(false)}
              className="p-1.5 rounded-[6px] text-[#AEAEB2] hover:text-[#6E6E73] hover:bg-[#F5F5F7] dark:hover:text-[#AEAEB2] dark:hover:bg-[#3A3A3C] transition-colors duration-150 cursor-pointer"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
          {secondaryItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 min-h-[48px] text-sm transition-colors duration-150 cursor-pointer
                ${isActive
                  ? 'text-[#0071E3] bg-[#E3F0FF] dark:text-[#409CFF] dark:bg-[rgba(64,156,255,0.12)]'
                  : 'text-[#6E6E73] hover:bg-[#F5F5F7] dark:text-[#AEAEB2] dark:hover:bg-[#3A3A3C]'
                }`
              }
            >
              <Icon size={18} strokeWidth={1.5} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      )}

      {/* Bottom tab bar — frosted glass style */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-[#D2D2D7] dark:bg-[#1C1C1E]/90 dark:border-[#3A3A3C] safe-area-bottom">
        <div className="flex items-stretch justify-around px-1">
          {primaryItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 py-2 px-2 min-h-[64px] min-w-[64px] flex-1 transition-colors duration-150 cursor-pointer
                ${isActive
                  ? 'text-[#0071E3] dark:text-[#409CFF]'
                  : 'text-[#AEAEB2] dark:text-[#6E6E73]'
                }`
              }
            >
              <Icon size={22} strokeWidth={1.5} />
              <span className="text-[11px] font-medium leading-none">{label}</span>
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 px-2 min-h-[64px] min-w-[64px] flex-1 transition-colors duration-150 cursor-pointer
              ${isSecondaryActive || moreMenuOpen
                ? 'text-[#0071E3] dark:text-[#409CFF]'
                : 'text-[#AEAEB2] dark:text-[#6E6E73]'
              }`}
          >
            <MoreHorizontal size={22} strokeWidth={1.5} />
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
