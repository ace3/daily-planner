import { describe, it, expect } from 'vitest';
import { getCurrentSessionInfo } from '../lib/session';
import { formatCountdown, formatDuration, timeToMinutes, subtractMinutes, addMinutesToTime } from '../lib/time';

const baseConfig = {
  tzOffset: 7,
  session1Kickstart: '09:00',
  planningEnd: '11:00',
  session2Start: '14:00',
  warnBeforeMin: 15,
};

describe('time utilities', () => {
  it('timeToMinutes converts correctly', () => {
    expect(timeToMinutes('09:00')).toBe(540);
    expect(timeToMinutes('14:30')).toBe(870);
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('formatCountdown formats correctly', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(65)).toBe('01:05');
    expect(formatCountdown(3661)).toBe('1:01:01');
  });

  it('formatDuration handles hours and minutes', () => {
    expect(formatDuration(30)).toBe('30m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
  });

  it('subtractMinutes handles midnight wrap', () => {
    expect(subtractMinutes('01:00', 90)).toBe('23:30');
  });

  it('addMinutesToTime handles day wrap', () => {
    expect(addMinutesToTime('23:00', 120)).toBe('01:00');
  });
});

describe('session phase detection', () => {
  it('getCurrentSessionInfo returns valid structure', () => {
    const info = getCurrentSessionInfo(baseConfig);
    expect(info).toHaveProperty('phase');
    expect(info).toHaveProperty('phaseLabel');
    expect(info).toHaveProperty('phaseColor');
    expect(info).toHaveProperty('timeUntilNext');
    expect(info).toHaveProperty('progress');
    expect(info.progress).toBeGreaterThanOrEqual(0);
    expect(info.progress).toBeLessThanOrEqual(100);
  });

  it('session info has correct schedule times', () => {
    const info = getCurrentSessionInfo(baseConfig);
    expect(info.session1Start).toBe('09:00');
    expect(info.planningEnd).toBe('11:00');
    expect(info.session2Start).toBe('14:00');
    expect(info.endOfDay).toBe('19:00'); // 14:00 + 5h
  });

  it('custom session2Start changes end of day', () => {
    const config = { ...baseConfig, session2Start: '13:00' };
    const info = getCurrentSessionInfo(config);
    expect(info.endOfDay).toBe('18:00'); // 13:00 + 5h
  });
});
