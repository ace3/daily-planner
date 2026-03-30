import React, { useEffect, useRef, useCallback, Component, type ErrorInfo, type ReactNode } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { Dashboard } from './pages/Dashboard';
import { TemplatesPage } from './pages/TemplatesPage';
import { SettingsPage } from './pages/Settings';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetail } from './pages/ProjectDetail';
import { RemoteAccessPage } from './pages/RemoteAccessPage';
import { TaskDetail } from './pages/TaskDetail';
import { QueuePage } from './pages/QueuePage';
import { Login } from './pages/Login';
import { ToastContainer } from './components/ui/Toast';
import { useSettingsStore } from './stores/settingsStore';
import { useTaskStore } from './stores/taskStore';
import { useProjectStore } from './stores/projectStore';
import { useProviderStore } from './stores/providerStore';
import { useSyncStore } from './stores/syncStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useMobileStore } from './stores/mobileStore';
import { useAuthStore } from './stores/authStore';
import { extractAndStoreToken, isWebBrowser } from './lib/http';
import { startSseClient, stopSseClient } from './lib/eventSource';
import { ChevronUp, ChevronDown } from 'lucide-react';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[ErrorBoundary]', error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-red-400">
          <h2 className="text-lg font-bold mb-2">Something went wrong</h2>
          <pre className="text-xs whitespace-pre-wrap">{this.state.error.message}</pre>
          <pre className="text-xs whitespace-pre-wrap mt-2 dark:text-gray-500">{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded">
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const AppInner: React.FC = () => {
  const { fetchSettings, settings } = useSettingsStore();
  const { fetchTasks } = useTaskStore();
  const { fetchProjects, initSelectedProject } = useProjectStore();
  const { checkAvailability } = useProviderStore();
  const { mobileMode } = useMobileStore();
  const { syncAll } = useSyncStore();
  const { isAuthenticated, isChecking, checkAuth } = useAuthStore();
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

  // Check auth session on mount (web browser only)
  useEffect(() => {
    if (isWebBrowser()) {
      extractAndStoreToken();
      checkAuth();
    }
  }, []);

  // Start SSE client in browser mode for real-time updates
  useEffect(() => {
    if (!isWebBrowser()) return;
    startSseClient({
      onTaskChanged: () => {
        useTaskStore.getState().fetchTasks();
      },
      onSettingsChanged: () => {
        useSettingsStore.getState().fetchSettings();
      },
      onProjectsChanged: () => {
        useProjectStore.getState().fetchProjects();
      },
    });
    return () => stopSseClient();
  }, []);

  useEffect(() => {
    fetchSettings().then(() => {});
    fetchProjects().then(() => initSelectedProject());
    checkAvailability();
  }, []);

  // Auto-poll every 30s to pick up changes made from the web interface
  useEffect(() => {
    const interval = setInterval(() => {
      syncAll(fetchTasks, fetchSettings, fetchProjects);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Sync immediately when the window regains focus
  useEffect(() => {
    const onFocus = () => syncAll(fetchTasks, fetchSettings, fetchProjects);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => {
    if (!settings) return;
    fetchTasks();
  }, [settings]);

  // In web browser mode, gate on auth; in Tauri desktop skip auth UI
  if (isWebBrowser()) {
    if (isChecking) {
      return (
        <div className="flex h-screen items-center justify-center bg-[#F5F5F7] dark:bg-[#0F1117]">
          <div className="w-8 h-8 rounded-full border-2 border-[#0071E3] border-t-transparent animate-spin" />
        </div>
      );
    }
    if (!isAuthenticated) {
      return <Login onSuccess={() => checkAuth()} />;
    }
  }

  return (
    <div
      className={`flex h-screen bg-white text-gray-900 dark:bg-[#0F1117] dark:text-[#E6EDF3] overflow-hidden
        ${mobileMode ? 'flex-col mobile-mode' : ''}`}
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {!mobileMode && <Sidebar />}
      <div ref={mainContentRef} className={`flex flex-col flex-1 min-w-0 ${mobileMode ? 'min-h-0 pb-[72px]' : ''}`}>
        <TopBar />
        <div className="flex-1 min-h-0 overflow-auto" data-scrollable>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/queue" element={<QueuePage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/tasks/:id" element={<TaskDetail />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/remote-access" element={<RemoteAccessPage />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </div>
      {mobileMode && <Sidebar />}

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
