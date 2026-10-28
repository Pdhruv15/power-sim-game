/** 13.5 → "13:30" */
export function hhmm(hour: number): string {
  const m = Math.round(hour * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const fmt = (n: number, digits = 1): string => n.toFixed(digits);
