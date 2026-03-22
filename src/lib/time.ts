import { format, parseISO } from 'date-fns';

export function getLocalDate(tzOffset: number = 7): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const localMs = utcMs + tzOffset * 3600000;
  const local = new Date(localMs);
  return format(local, 'yyyy-MM-dd');
}

export function getLocalTime(tzOffset: number = 7): Date {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const localMs = utcMs + tzOffset * 3600000;
  return new Date(localMs);
}

export function getLocalHHMM(tzOffset: number = 7): string {
  const local = getLocalTime(tzOffset);
  return format(local, 'HH:mm');
}

export function parseHHMM(time: string): { hours: number; minutes: number } {
  const [hours, minutes] = time.split(':').map(Number);
  return { hours: hours || 0, minutes: minutes || 0 };
}

export function timeToMinutes(time: string): number {
  const { hours, minutes } = parseHHMM(time);
  return hours * 60 + minutes;
}

export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function subtractMinutes(time: string, mins: number): string {
  const totalMins = timeToMinutes(time) - mins;
  const adjusted = ((totalMins % (24 * 60)) + 24 * 60) % (24 * 60);
  return minutesToHHMM(adjusted);
}

export function addMinutesToTime(time: string, mins: number): string {
  const totalMins = timeToMinutes(time) + mins;
  const adjusted = totalMins % (24 * 60);
  return minutesToHHMM(adjusted);
}

export function formatDisplayTime(time: string): string {
  const { hours, minutes } = parseHHMM(time);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
}

export function isoToLocalDisplay(isoString: string): string {
  try {
    return format(parseISO(isoString), 'MMM d, yyyy HH:mm');
  } catch {
    return isoString;
  }
}
