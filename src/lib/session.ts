import { getLocalTime, timeToMinutes, addMinutesToTime } from './time';
import type { SessionInfo, SessionPhase } from '../types/session';

export interface SessionConfig {
  tzOffset: number;
  session1Kickstart: string; // "09:00"
  planningEnd: string;       // "11:00"
  session2Start: string;     // "14:00"
  warnBeforeMin: number;     // 15
}

export function getCurrentSessionInfo(config: SessionConfig): SessionInfo {
  const now = getLocalTime(config.tzOffset);
  const currentMins = now.getHours() * 60 + now.getMinutes();
  const currentSecs = now.getSeconds();

  const kickstartMins = timeToMinutes(config.session1Kickstart);
  const planningEndMins = timeToMinutes(config.planningEnd);
  const session2Mins = timeToMinutes(config.session2Start);
  const endOfDayMins = session2Mins + 5 * 60; // 5h after session2
  const warn1Mins = session2Mins - config.warnBeforeMin;
  const warn2Mins = endOfDayMins - config.warnBeforeMin;

  const endOfDay = addMinutesToTime(config.session2Start, 5 * 60);

  let phase: SessionPhase;
  let phaseLabel: string;
  let phaseColor: string;
  let nextEventMins: number;
  let nextEventLabel: string;
  let phaseStartMins: number;
  let phaseEndMins: number;

  if (currentMins < kickstartMins) {
    phase = 'off';
    phaseLabel = 'Before work hours';
    phaseColor = '#6B7280';
    nextEventMins = kickstartMins;
    nextEventLabel = 'Session kickstart';
    phaseStartMins = 0;
    phaseEndMins = kickstartMins;
  } else if (currentMins < planningEndMins) {
    phase = currentMins === kickstartMins ? 'kickstart' : 'planning';
    phaseLabel = 'Planning Phase';
    phaseColor = '#3B82F6'; // blue
    nextEventMins = planningEndMins;
    nextEventLabel = 'Switch to Claude Code';
    phaseStartMins = kickstartMins;
    phaseEndMins = planningEndMins;
  } else if (currentMins < warn1Mins) {
    phase = 'coding';
    phaseLabel = 'Coding Phase';
    phaseColor = '#10B981'; // green
    nextEventMins = warn1Mins;
    nextEventLabel = 'Session reset warning';
    phaseStartMins = planningEndMins;
    phaseEndMins = warn1Mins;
  } else if (currentMins < session2Mins) {
    phase = 'session1_warning';
    phaseLabel = 'Session Ending Soon!';
    phaseColor = '#F59E0B'; // amber
    nextEventMins = session2Mins;
    nextEventLabel = 'Fresh session reset!';
    phaseStartMins = warn1Mins;
    phaseEndMins = session2Mins;
  } else if (currentMins < session2Mins + 5) {
    phase = 'session2';
    phaseLabel = 'Fresh Session!';
    phaseColor = '#10B981';
    nextEventMins = warn2Mins;
    nextEventLabel = 'End of day warning';
    phaseStartMins = session2Mins;
    phaseEndMins = warn2Mins;
  } else if (currentMins < warn2Mins) {
    phase = 'session2_active';
    phaseLabel = 'Afternoon Session';
    phaseColor = '#10B981';
    nextEventMins = warn2Mins;
    nextEventLabel = 'Day ending soon';
    phaseStartMins = session2Mins;
    phaseEndMins = warn2Mins;
  } else if (currentMins < endOfDayMins) {
    phase = 'session2_warning';
    phaseLabel = 'Day Ending Soon!';
    phaseColor = '#F59E0B';
    nextEventMins = endOfDayMins;
    nextEventLabel = 'End of day';
    phaseStartMins = warn2Mins;
    phaseEndMins = endOfDayMins;
  } else {
    phase = 'end_of_day';
    phaseLabel = 'Day Complete';
    phaseColor = '#6B7280';
    nextEventMins = kickstartMins + 24 * 60; // tomorrow
    nextEventLabel = 'Tomorrow kickstart';
    phaseStartMins = endOfDayMins;
    phaseEndMins = kickstartMins + 24 * 60;
  }

  // Calculate seconds until next event
  let timeUntilNext = (nextEventMins - currentMins) * 60 - currentSecs;
  if (timeUntilNext < 0) timeUntilNext = 0;

  // Progress within current phase (0-100)
  const phaseDuration = (phaseEndMins - phaseStartMins) * 60;
  const phaseElapsed = (currentMins - phaseStartMins) * 60 + currentSecs;
  const progress = phaseDuration > 0
    ? Math.min(100, Math.max(0, (phaseElapsed / phaseDuration) * 100))
    : 0;

  const nextHours = Math.floor(nextEventMins / 60) % 24;
  const nextMins = nextEventMins % 60;
  const nextEventTime = `${String(nextHours).padStart(2, '0')}:${String(nextMins).padStart(2, '0')}`;

  return {
    phase,
    phaseLabel,
    phaseColor,
    timeUntilNext,
    nextEventLabel,
    nextEventTime,
    session1Start: config.session1Kickstart,
    planningEnd: config.planningEnd,
    session2Start: config.session2Start,
    endOfDay,
    progress,
  };
}

export function getSessionSlotForCurrentTime(config: SessionConfig): number {
  const now = getLocalTime(config.tzOffset);
  const currentMins = now.getHours() * 60 + now.getMinutes();
  return currentMins >= timeToMinutes(config.session2Start) ? 2 : 1;
}
