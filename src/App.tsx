import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { Dashboard } from './pages/Dashboard';
import { PromptPage } from './pages/PromptPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { Reports } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { ProjectsPage } from './pages/ProjectsPage';
import { RemoteAccessPage } from './pages/RemoteAccessPage';
import { HistoryPage } from './pages/HistoryPage';
import { MorningPlanning } from './pages/MorningPlanning';
import { ToastContainer } from './components/ui/Toast';
import { useSettingsStore } from './stores/settingsStore';
import { useTaskStore } from './stores/taskStore';
import { useProjectStore } from './stores/projectStore';
import { useProviderStore } from './stores/providerStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useMobileStore } from './stores/mobileStore';
import { getLocalDate, getLocalTime, timeToMinutes } from './lib/time';
import { ChevronUp, ChevronDown } from 'lucide-react';

const AppInner: React.FC = () => {
  const { fetchSettings, settings } = useSettingsStore();
  const { fetchTasks } = useTaskStore();
  const { fetchProjects, initSelectedProject } = useProjectStore();
  const { checkAvailability } = useProviderStore();
  const { mobileMode } = useMobileStore();
  const [showMorningPlanning, setShowMorningPlanning] = useState(false);
  const navigate = useNavigate();
  const mainContentRef = useRef<HTMLDivElement>(null);

  const scrollBy = useCallback((amount: number) => {
    const container = mainContentRef.current;
    if (!container) return;
    // Find the deepest scrollable child, or fall back to the container itself
    const scrollable = container.querySelector('[data-scrollable]') as HTMLElement
      ?? Array.from(container.querySelectorAll('*')).find(
        (el) => el instanceof HTMLElement && el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible' && getComputedStyle(el).overflowY !== 'hidden'
      ) as HTMLElement
      ?? container;
    scrollable.scrollBy({ top: amount, behavior: 'smooth' });
  }, []);

  useKeyboardShortcuts();

  useEffect(() => {
    fetchSettings().then(() => {});
    fetchProjects().then(() => initSelectedProject());
    checkAvailability();
  }, []);

  useEffect(() => {
    if (!settings) return;
    const today = getLocalDate(settings.timezone_offset);
    fetchTasks(today);

    // Check if we should show morning planning modal
    const now = getLocalTime(settings.timezone_offset);
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const kickstartMins = timeToMinutes(settings.session1_kickstart);
    const planningEndMins = timeToMinutes(settings.planning_end);

    // Show if within the first 30 min of kickstart and planning phase not ended
    if (currentMins >= kickstartMins && currentMins < kickstartMins + 30 && currentMins < planningEndMins) {
      const lastShownKey = `morning-planning-shown-${today}`;
      const alreadyShown = sessionStorage.getItem(lastShownKey);
      if (!alreadyShown) {
        setShowMorningPlanning(true);
        sessionStorage.setItem(lastShownKey, '1');
      }
    }
  }, [settings]);

  return (
    <div
      className={`flex h-screen bg-white text-gray-900 dark:bg-[#0F1117] dark:text-[#E6EDF3] overflow-hidden
        ${mobileMode ? 'flex-col mobile-mode' : ''}`}
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {!mobileMode && <Sidebar />}
      <div ref={mainContentRef} className={`flex flex-col flex-1 min-w-0 ${mobileMode ? 'min-h-0 pb-[72px]' : ''}`}>
        <TopBar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/prompt" element={<PromptPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/remote-access" element={<RemoteAccessPage />} />
        </Routes>
      </div>
      {mobileMode && <Sidebar />}

      {showMorningPlanning && (
        <MorningPlanning
          onClose={() => setShowMorningPlanning(false)}
          onGoToFocus={() => {
            setShowMorningPlanning(false);
            navigate('/prompt');
          }}
        />
      )}

      <ToastContainer />

      {/* Floating scroll buttons for mobile (RustDesk scrolling is problematic) */}
      {mobileMode && (
        <div className="fixed right-3 bottom-[88px] flex flex-col gap-2 z-50">
          <button
            onClick={() => scrollBy(-300)}
            className="w-11 h-11 rounded-full bg-gray-800/80 dark:bg-gray-700/80 text-white shadow-lg backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform"
            aria-label="Scroll up"
          >
            <ChevronUp size={22} />
          </button>
          <button
            onClick={() => scrollBy(300)}
            className="w-11 h-11 rounded-full bg-gray-800/80 dark:bg-gray-700/80 text-white shadow-lg backdrop-blur-sm flex items-center justify-center active:scale-90 transition-transform"
            aria-label="Scroll down"
          >
            <ChevronDown size={22} />
          </button>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => (
  <HashRouter>
    <AppInner />
  </HashRouter>
);

export default App;
