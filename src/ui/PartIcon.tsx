const ICONS = {
  battery: <><rect x="2.5" y="7.5" width="17" height="10" rx="1.5" /><path d="M22 11v3M6 12.5h4M8 10.5v4M13 12.5h3.5" /></>,
  supply: <path d="M12 2.5 7 21.5M12 2.5l5 19M6.5 7.5h11M3.5 11.5h17M8.8 15.5h6.4M8 18.5l7.5-3M16 18.5l-7.5-3" />,
  switch: <><circle cx="7" cy="16" r="1.6" /><circle cx="17" cy="16" r="1.6" /><path d="M2.5 16h3M18.6 16h3M8.2 15 15.5 8" /></>,
  breaker: <><rect x="6" y="2.5" width="12" height="19" rx="1.5" /><rect x="9.5" y="6.5" width="5" height="7" rx="1" /><path d="M9.5 10h5M12 17v2" /></>,
  bulb: <path d="M9.5 18.5h5M10.5 21.5h3M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.9.7 1.3 1.4 1.3 2.2h5c0-.8.4-1.5 1.3-2.2A6.5 6.5 0 0 0 12 2.5Z" />,
  socket: <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><circle cx="8.5" cy="11" r="1.3" /><circle cx="15.5" cy="11" r="1.3" /><path d="M12 15v2" /></>,
  board: <><rect x="3" y="3.5" width="18" height="17" rx="1.5" /><path d="M3 8h18M7.5 11.5v5M12 11.5v5M16.5 11.5v5" /></>,
  sofa: <path d="M5.5 11V8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3M2.5 11h3.5v3.5h12V11h3.5v7h-19ZM5.5 18v2M18.5 18v2" />,
  bed: <path d="M3 5v15M3 16.5h18V20M21 16.5V13a3 3 0 0 0-3-3h-7.5v6.5M6.8 12.7a1.6 1.6 0 1 0 0-.1" />,
  pot: <path d="M5 10.5h14v7.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2ZM2.5 10.5h19M9 7V4.5M15 7V4.5" />,
  bath: <path d="M3 12h18v2.5a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5ZM6 12V6.5a2.5 2.5 0 0 1 5 0" />,
  washer: <><rect x="4.5" y="2.5" width="15" height="19" rx="2" /><circle cx="12" cy="13.5" r="4.5" /><path d="M7.5 6h2.5" /></>,
  table: <path d="M3 10h18M6 10v10.5M18 10v10.5M8.5 6h7M12 6v4" />,
  plug: <path d="M9 2.5v5M15 2.5v5M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0ZM12 16.5v5" />,
} as const;

export type IconName = keyof typeof ICONS;

/** Picture for a room, from the words in its name. */
export function roomIcon(room: string): IconName {
  if (/bed/i.test(room)) return 'bed';
  if (/kitchen/i.test(room)) return 'pot';
  if (/bath/i.test(room)) return 'bath';
  if (/laundry/i.test(room)) return 'washer';
  if (/dining/i.test(room)) return 'table';
  if (/living|majlis/i.test(room)) return 'sofa';
  if (/light/i.test(room)) return 'bulb';
  return 'plug';
}

/** What a label on a connection point means, shown when the pointer rests on it. */
export const TERM_TITLES: Readonly<Record<string, string>> = {
  IN: 'Power comes in here',
  OUT: 'Power goes out here',
  L: 'Live: the side power comes from',
  N: 'Neutral: the way back',
  '+': 'Battery plus: current leaves here',
  '−': 'Battery minus: current comes back here',
};

export function PartIcon({ name, size = 28 }: { name: IconName; size?: number }) {
  return (
    <svg className="part-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
