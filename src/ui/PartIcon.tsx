import type { LoadType } from '../sim';

const letter = (text: string, size = 15) => <text x="20" y={20 + size * 0.36} textAnchor="middle" fontSize={size} fontWeight="600" fill="currentColor" stroke="none">{text}</text>;

/** Single-line symbols, drawn on a 40 by 40 grid. */
const SYMBOLS = {
  // Loads
  motor: <><circle cx="20" cy="20" r="15" />{letter('M')}</>,
  lamp: <><circle cx="20" cy="20" r="15" /><path d="M9.4 9.4 30.6 30.6M30.6 9.4 9.4 30.6" /></>,
  socket: <path d="M20 6v8M6 32a14 14 0 0 1 28 0Z" />,
  heater: <><rect x="5" y="10" width="30" height="20" rx="1" /><path d="M8 20l4-6 4 12 4-12 4 12 4-12 4 6" /></>,
  ev: <><rect x="6" y="6" width="28" height="28" rx="2" /><path d="M23 10 14 21h10l-8 10" /></>,
  electronics: <><rect x="6" y="6" width="28" height="28" rx="1" /><path d="M6 34 34 6M11 14q2.5-3.500 5 0t5 0M22 28h8" /></>,
  // Sources
  supply: <><circle cx="20" cy="20" r="15" /><path d="M10 20q5-10 10 0t10 0" /></>,
  generator: <><circle cx="20" cy="20" r="15" />{letter('G')}</>,
  solar: <><rect x="8" y="12" width="26" height="22" rx="1" /><path d="M8 34 34 12M3 3l7 7M13 2l5 7" /></>,
  wind: <><path d="M20 16V38M20 16V3M20 16 6 24M20 16 34 24" /><circle cx="20" cy="16" r="2" /></>,
  hydro: <><circle cx="20" cy="15" r="12" /><text x="20" y="19.500" textAnchor="middle" fontSize="12" fontWeight="600" fill="currentColor" stroke="none">G</text><path d="M4 34q4-5 8 0t8 0 8 0 8 0" /></>,
  battery: <path d="M20 3v10M8 13h24M14 19h12M8 25h24M14 31h12M20 31v6" />,
  steam: <><path d="M3 12l14-6v28L3 28Z" /><circle cx="27" cy="20" r="10" /><text x="27" y="24" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" stroke="none">G</text></>,
  // Network
  transformer: <><circle cx="14" cy="20" r="10" /><circle cx="26" cy="20" r="10" /></>,
  breaker: <><path d="M20 3v8M20 29v8" /><rect x="11" y="11" width="18" height="18" /><path d="M11 11l18 18M29 11 11 29" /></>,
  switch: <path d="M3 26h9M28 26h9M12 26 27 15" />,
  isolator: <><path d="M3 26h10M27 26h10M13 26 26 14" /><circle cx="27" cy="26" r="1.800" /><path d="M23 22v8" /></>,
  busbar: <><path d="M6 20h28" strokeWidth="5" /><path d="M12 8v12M28 8v12M20 20v12" /></>,
  earth: <path d="M20 4v18M7 22h26M12 28h16M17 34h6" />,
  capacitor: <path d="M20 4v13M6 17h28M6 23h28M20 23v13" />,
  board: <><rect x="4" y="5" width="32" height="30" rx="1" /><path d="M9 12h22" strokeWidth="3" /><path d="M13 12v5M27 12v5M20 12v5" /><rect x="10" y="17" width="6" height="11" /><rect x="17" y="17" width="6" height="11" /><rect x="24" y="17" width="6" height="11" /></>,
} as const;

export type IconName = keyof typeof SYMBOLS;
export const ICON_NAMES = Object.keys(SYMBOLS) as IconName[];

const LOAD_ICONS: Readonly<Record<LoadType, IconName>> = {
  lighting: 'lamp', sockets: 'socket', ac: 'motor', shop: 'board', school: 'board',
  heater: 'heater', pump: 'motor', lift: 'motor', computers: 'electronics', ev: 'ev', streetlight: 'lamp', hospital: 'electronics',
};

/** Symbol for a circuit, from the kind of load it feeds. */
export const loadIcon = (type: LoadType): IconName => LOAD_ICONS[type];

/** What a label on a connection point means, shown when the pointer rests on it. */
export const TERM_TITLES: Readonly<Record<string, string>> = {
  IN: 'Power comes in here',
  OUT: 'Power goes out here',
  L: 'Live: the side power comes from',
  N: 'Neutral: the way back',
  E: 'Earth: carries current only in a fault',
  '+': 'Battery plus: current leaves here',
  '−': 'Battery minus: current comes back here',
};

export function PartIcon({ name, size = 28 }: { name: IconName; size?: number }) {
  return (
    <svg className="part-icon" data-symbol={name} viewBox="0 0 40 40" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {SYMBOLS[name]}
    </svg>
  );
}
