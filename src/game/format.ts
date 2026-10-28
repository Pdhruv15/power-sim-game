/** 13.5 → "13:30"; 24 → "24:00" (end of the day). */
export function hhmm(hour: number): string {
  const m = Math.round(hour * 60);
  if (m >= 1440) return '24:00';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const fmt = (n: number, digits = 1): string => n.toFixed(digits);
