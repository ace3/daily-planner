import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';

export function useSessionTimer() {
  const { tick, setConfig, sessionInfo, currentDate } = useSessionStore();
  const { settings } = useSettingsStore();
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!settings) return;
    setConfig({
      tzOffset: settings.timezone_offset,
      session1Kickstart: settings.session1_kickstart,
      planningEnd: settings.planning_end,
      session2Start: settings.session2_start,
      warnBeforeMin: settings.warn_before_min,
    });
  }, [settings]);

  useEffect(() => {
    tick();
    intervalRef.current = window.setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tick]);

  return { sessionInfo, currentDate };
}
