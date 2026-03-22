import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { Dashboard } from './pages/Dashboard';
import { FocusMode } from './pages/FocusMode';
import { PromptPage } from './pages/PromptPage';
import { Reports } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { MorningPlanning } from './pages/MorningPlanning';
import { ToastContainer } from './components/ui/Toast';
import { useSettingsStore } from './stores/settingsStore';
import { useTaskStore } from './stores/taskStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { getLocalDate, getLocalTime, timeToMinutes } from './lib/time';

const AppInner: React.FC = () => {
  const { fetchSettings, settings } = useSettingsStore();
  const { fetchTasks } = useTaskStore();
  const [showMorningPlanning, setShowMorningPlanning] = useState(false);
  const navigate = useNavigate();

  useKeyboardShortcuts();

  useEffect(() => {
    fetchSettings().then(() => {});
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
    <div className="flex h-screen bg-[#0F1117] text-[#E6EDF3] overflow-hidden" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/focus" element={<FocusMode />} />
          <Route path="/prompt" element={<PromptPage />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>

      {showMorningPlanning && (
        <MorningPlanning
          onClose={() => setShowMorningPlanning(false)}
          onGoToFocus={() => {
            setShowMorningPlanning(false);
            navigate('/focus');
          }}
        />
      )}

      <ToastContainer />
    </div>
  );
};

const App: React.FC = () => (
  <HashRouter>
    <AppInner />
  </HashRouter>
);

export default App;
