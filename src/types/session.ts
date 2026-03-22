export type SessionPhase =
  | 'kickstart'      // 9AM: start prompting
  | 'planning'       // 9AM-11AM: planning with Claude
  | 'coding'         // 11AM-2PM: Claude Code development
  | 'session1_warning' // 13:45: 15-min warning
  | 'session2'       // 14PM: fresh session
  | 'session2_active'  // 14PM-18:45: second session
  | 'session2_warning' // 18:45: 15-min warning
  | 'end_of_day'     // 19PM: done
  | 'off';           // outside working hours

export interface SessionInfo {
  phase: SessionPhase;
  phaseLabel: string;
  phaseColor: string;
  timeUntilNext: number; // seconds
  nextEventLabel: string;
  nextEventTime: string; // HH:MM
  session1Start: string;
  planningEnd: string;
  session2Start: string;
  endOfDay: string;
  progress: number; // 0-100 within current phase
}
