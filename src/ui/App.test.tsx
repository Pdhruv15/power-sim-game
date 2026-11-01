// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// jsdom gives import.meta.url an http scheme, so read the level from the project root
const file = (name: string) => readFileSync(resolve(process.cwd(), 'public/data', name), 'utf8');
const LEVEL_FILES: Record<string, string> = Object.fromEntries(['villa.json', 'two-villas.json', 'building.json', 'village.json'].map(n => [n, file(n)]));

const STARTER_DONE = { 'level-circuit': { score: 3, stars: 3 }, 'level-room': { score: 3, stars: 3 } };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('power-sim:progress:v1', JSON.stringify(STARTER_DONE));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(LEVEL_FILES[url.split('/').pop()!], { status: 200 })));
  // jsdom has no WebGL: the 3D view shows its fallback message and the rest of the game still runs.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const pick = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } });
const scorePanel = () => within(document.querySelector<HTMLElement>('.panel.score')!);
const runAndSkip = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Run the day' }));
  fireEvent.click(screen.getByRole('button', { name: 'Skip to result' }));
};

/** One villa opens on its empty plan. These tests fix the installer's wiring instead. */
const openInstallerWiring = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Fix the installer’s wiring' }));
  await screen.findByRole('button', { name: 'Run the day' });
};

describe('Building the villa', () => {
  const click = (id: string) => fireEvent.click(document.getElementById(id)!);
  const wire = (from: string, to: string) => { click(from); click(to); };
  const SAFE: Record<string, [string, string]> = {
    C1: ['6', '1.5'], C2: ['20', '2.5'], C3: ['6', '1.5'], C4: ['20', '2.5'], C5: ['20', '2.5'], C6: ['16', '2.5'], C7: ['10', '1.5'], C8: ['16', '2.5'],
  };
  const wireRooms = () => Object.entries(SAFE).forEach(([id, [breaker, cable]]) => {
    pick(`brk-${id}`, breaker);
    click(`cable-${cable}`);
    wire('term-DB-out', `term-${id}`);
  });
  const coins = () => (JSON.parse(localStorage.getItem('power-sim:wallet:v1') ?? '{"coins":20}') as { coins: number }).coins;

  it('starts empty, and says what is missing until every room is wired', async () => {
    render(<App />);
    await screen.findByText('0 of 8 rooms wired');
    expect(screen.queryByRole('button', { name: 'Run the day' })).toBeNull();
    click('power-on');
    expect(screen.getByRole('status').textContent).toMatch(/Place the Villa DB/);
    click('tray-DB');
    click('power-on');
    expect(screen.getByRole('status').textContent).toMatch(/Wire the street supply/);
    wire('term-street', 'term-DB-in');
    click('power-on');
    expect(screen.getByRole('status').textContent).toMatch(/8 rooms have no cable/);
  });

  it('runs a finished build through the real day, pays coins, and keeps the build to fix', async () => {
    render(<App />);
    await screen.findByText('0 of 8 rooms wired');
    click('tray-DB');
    wire('term-street', 'term-DB-in');
    wireRooms();
    pick('brk-DB', '80');
    pick('solar', '5');
    expect(screen.getByText('8 of 8 rooms wired')).toBeTruthy();
    expect(screen.getByText(/credits/).textContent).toMatch(/\/ 1100 credits/);

    click('power-on');
    expect(screen.getByText('Load through the day')).toBeTruthy(); // the normal day replay
    fireEvent.click(screen.getByRole('button', { name: 'Skip to result' }));
    expect(scorePanel().getByLabelText('3 of 3 stars')).toBeTruthy();
    expect(scorePanel().getByText('+60 coins')).toBeTruthy();
    expect(coins()).toBe(80);

    fireEvent.click(screen.getByRole('button', { name: 'Fix the design' }));
    expect(screen.getByText('8 of 8 rooms wired')).toBeTruthy();
    expect((document.getElementById('brk-DB') as HTMLSelectElement).value).toBe('80');
  });

  it('rejects a wire that does nothing, and removes a selected one', async () => {
    render(<App />);
    await screen.findByText('0 of 8 rooms wired');
    click('tray-DB');
    wire('term-street', 'term-C1');
    expect(screen.getByRole('status').textContent).toMatch(/does nothing here/);
    wire('term-DB-out', 'term-C1');
    expect(screen.getByText('1 of 8 rooms wired')).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole('button', { name: /Majlis cable/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove the wire' }));
    expect(screen.getByText('0 of 8 rooms wired')).toBeTruthy();
  });

  it('pays coins on the other design levels too, once per star', async () => {
    render(<App />);
    await openInstallerWiring();
    runAndSkip();
    expect(scorePanel().getByText('+20 coins')).toBeTruthy(); // 1 star
    expect(coins()).toBe(40);
    fireEvent.click(screen.getByRole('button', { name: 'Fix the design' }));
    runAndSkip();
    expect(scorePanel().queryByText(/\+\d+ coins/)).toBeNull();
    expect(coins()).toBe(40);
  });
});

describe('Building two villas', () => {
  const click = (id: string) => fireEvent.click(document.getElementById(id)!);
  const wire = (from: string, to: string) => { click(from); click(to); };
  const SPREAD: Record<string, string> = { 1: 'L1', 5: 'L1', 2: 'L2', 6: 'L2', 3: 'L3', 4: 'L3' };
  const ROOM: Record<string, [string, string]> = { 1: ['25', '4'], 2: ['20', '2.5'], 3: ['16', '2.5'], 4: ['20', '2.5'], 5: ['10', '1.5'], 6: ['16', '2.5'] };
  const sheet = (id: string) => click(`open-${id}`);
  const up = () => click('sheet-up');
  const open = async () => {
    localStorage.setItem('power-sim:progress:v1', JSON.stringify({ ...STARTER_DONE, 'level-1-villa': { score: 955, stars: 3 } }));
    render(<App />);
    await screen.findByText('0 of 12 rooms wired');
  };

  it('opens on an empty plan, and reads each board phase split live', async () => {
    await open();
    click('tray-FP');
    click('tray-VA');
    click('tray-VB');
    expect(document.getElementById('part-VA')!.textContent).toMatch(/L1 62 · L2 0 · L3 0/);
    sheet('VA');
    pick('ph-A2', 'L2');
    expect(document.getElementById('part-VA')!.textContent).toMatch(/L2 1[0-9]/);
    expect(screen.getByText('Villa B feeder · 85 m')).toBeTruthy();
    expect(screen.queryByLabelText('Solar on the roof')).toBeNull(); // this level does not score solar
  });

  it('only accepts wires down the tree', async () => {
    await open();
    click('tray-FP');
    click('tray-VA');
    wire('term-street', 'term-VA-in');
    expect(screen.getByRole('status').textContent).toMatch(/does nothing here/);
    wire('term-VA-out', 'term-FP-in');
    expect(screen.getByRole('status').textContent).toMatch(/does nothing here/);
    sheet('VA');
    wire('term-VA-out', 'term-A1');
    expect(screen.getByText('1 of 12 rooms wired')).toBeTruthy();
  });

  it('keeps the plan to boards, and opens each one on a sheet of its own rooms', async () => {
    await open();
    ['FP', 'VA', 'VB'].forEach(id => click(`tray-${id}`));
    expect(document.querySelector('.room-part')).toBeNull();
    expect(document.getElementById('term-street')).toBeTruthy();
    expect(document.getElementById('part-VA')!.textContent).toMatch(/0 of 6 wired/);

    sheet('VA');
    expect(document.querySelectorAll('.room-part')).toHaveLength(6);
    expect(document.getElementById('room-A1')).toBeTruthy();
    expect(document.getElementById('room-B1')).toBeNull();
    expect(document.getElementById('term-street')).toBeNull();
    expect(document.getElementById('part-VB')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Sheets' }).textContent).toMatch(/Two villas.*Villa A/);

    wire('term-VA-out', 'term-A1');
    expect(document.querySelectorAll('.wire')).toHaveLength(1);
    up();
    expect(document.querySelector('.room-part')).toBeNull();
    expect(document.getElementById('part-VA')!.textContent).toMatch(/1 of 6 wired/);
    expect(document.querySelectorAll('.wire')).toHaveLength(0); // room wires stay on their sheet
    expect(screen.getByText('1 of 12 rooms wired')).toBeTruthy();
  });

  it('runs a full, balanced build for full marks, and keeps it to fix', async () => {
    await open();
    ['FP', 'VA', 'VB'].forEach(id => click(`tray-${id}`));
    wire('term-street', 'term-FP-in');
    pick('brk-FP', '100');
    click('cable-16');
    pick('brk-VA', '63');
    wire('term-FP-out', 'term-VA-in');
    click('cable-10');
    pick('brk-VB', '40');
    wire('term-FP-out', 'term-VB-in');
    for (const v of ['A', 'B']) {
      sheet(`V${v}`);
      for (const n of ['1', '2', '3', '4', '5', '6']) {
        pick(`brk-${v}${n}`, ROOM[n][0]);
        pick(`ph-${v}${n}`, SPREAD[n]);
        click(`cable-${ROOM[n][1]}`);
        wire(`term-V${v}-out`, `term-${v}${n}`);
      }
      up();
    }
    click('power-on');
    fireEvent.click(screen.getByRole('button', { name: 'Skip to result' }));
    expect(scorePanel().getByText('1000')).toBeTruthy();
    expect(scorePanel().getByLabelText('3 of 3 stars')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fix the design' }));
    expect(screen.getByText('12 of 12 rooms wired')).toBeTruthy();
  });

  it('removes a board along with every wire touching it', async () => {
    await open();
    click('tray-FP');
    click('tray-VA');
    wire('term-street', 'term-FP-in');
    wire('term-FP-out', 'term-VA-in');
    sheet('VA');
    wire('term-VA-out', 'term-A1');
    up();
    fireEvent.pointerDown(document.getElementById('part-VA')!, { clientX: 300, clientY: 100 });
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole('button', { name: 'Remove the board' }));
    expect(document.getElementById('part-VA')).toBeNull();
    expect(screen.getByText('0 of 12 rooms wired')).toBeTruthy();
    expect(document.querySelectorAll('.wire')).toHaveLength(1); // the street to the pillar stays
  });
});

describe('Level 1 flow', () => {  it('runs the day, shows the mistakes, and gives 3 stars once fixed', async () => {
    render(<App />);
    await openInstallerWiring();
    expect(await screen.findByText(/3D view could not start/)).toBeTruthy();
    expect(screen.getByText(/needs up to 11.6 A at 15:00/)).toBeTruthy();

    runAndSkip();
    expect(screen.getByText('Day result')).toBeTruthy();
    expect(scorePanel().getByText('745')).toBeTruthy();
    expect(scorePanel().getByLabelText('1 of 3 stars')).toBeTruthy();
    expect(screen.getByText(/Breaker too small: Bedroom 2/)).toBeTruthy();
    expect(screen.getByText(/Breaker bigger than the cable: Kitchen/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Fix the design' }));
    pick('cab-C4', '2.5');
    pick('brk-C5', '20');
    pick('brk-C6', '16');
    pick('cab-C6', '2.5');
    pick('brk-DB', '80');
    expect(screen.getByText(/1040 \/ 1100 credits/)).toBeTruthy();

    runAndSkip();
    expect(scorePanel().getByText('955')).toBeTruthy();
    expect(scorePanel().getByLabelText('3 of 3 stars')).toBeTruthy();
    expect(screen.getByText(/Power stayed on all day/)).toBeTruthy();
  });

  it('shows the load chart only once the day has run, with a readout and an hourly table', async () => {
    render(<App />);
    await openInstallerWiring();
    expect(screen.queryByText('Load through the day')).toBeNull();

    // At the start of the replay the chart is up, but has not drawn the day or its trips yet
    fireEvent.click(screen.getByRole('button', { name: 'Run the day' }));
    expect(screen.getByText('Load through the day')).toBeTruthy();
    expect(document.querySelector('.panel.chart clipPath rect')!.getAttribute('width')).toBe('0');
    expect(document.querySelectorAll('.panel.chart .mark')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Skip to result' }));
    const chart = screen.getByRole('img', { name: /Busiest phase through the day/ });
    expect(screen.getByText('Main breaker 63 A')).toBeTruthy();
    expect(screen.getByText(/Bedroom 2 breaker tripped/)).toBeTruthy(); // the trip's mark
    expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(26); // header and 00:00 to 24:00

    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(document.querySelector('.chart-tip time')!.textContent).toBe('12:30');
    fireEvent.blur(chart);
    expect(document.querySelector('.chart-tip')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fix the design' }));
    expect(screen.queryByText('Load through the day')).toBeNull();
  });

  it('opens Two villas once One villa has a star', async () => {
    render(<App />);
    await openInstallerWiring();
    const level2 = screen.getByRole('button', { name: /Level 4/ }) as HTMLButtonElement;
    expect(level2.disabled).toBe(true);

    runAndSkip();
    expect(level2.disabled).toBe(false);
    fireEvent.click(level2);
    await openInstallerWiring();
    expect(screen.getByText(/feeder pillar at the gate/)).toBeTruthy();
    expect(screen.getAllByText(/busiest at 18:00: L1 62 · L2 0 · L3 0 A/)).toHaveLength(2); // both villas

    runAndSkip();
    expect(scorePanel().getByText(/Main breaker too small/)).toBeTruthy();
    expect(scorePanel().getByText(/Phases unbalanced: Villa A/)).toBeTruthy();
  });

  it('plays the building with the short-circuit hint', async () => {
    localStorage.setItem('power-sim:progress:v1', JSON.stringify({
      ...STARTER_DONE, 'level-1-villa': { score: 905, stars: 3 }, 'level-2-two-villas': { score: 800, stars: 2 },
    }));
    render(<App />);
    await screen.findByRole('button', { name: 'Run the day' });
    fireEvent.click(screen.getByRole('button', { name: /Level 5/ }));
    expect(await screen.findByText(/Short circuit here at 19:30: about 518 A/)).toBeTruthy();
    expect(document.getElementById('ph-2B')).toBeTruthy(); // each flat picks its phase

    runAndSkip();
    expect(scorePanel().getByText('513')).toBeTruthy();
    expect(scorePanel().getByText(/Too many breakers tripped: Kitchen/)).toBeTruthy();
  });

  it('plays the village with a transformer choice', async () => {
    localStorage.setItem('power-sim:progress:v1', JSON.stringify({
      ...STARTER_DONE, 'level-1-villa': { score: 905, stars: 3 }, 'level-2-two-villas': { score: 800, stars: 2 }, 'level-3-building': { score: 800, stars: 2 },
    }));
    render(<App />);
    await screen.findByRole('button', { name: 'Run the day' });
    fireEvent.click(screen.getByRole('button', { name: /Level 6/ }));
    expect(await screen.findByText(/Every room at once: 85 kVA · busiest moment: 69 kVA at 12:00/)).toBeTruthy();
    expect(screen.getByText(/Busiest phase: 416 % of this size/)).toBeTruthy();

    runAndSkip();
    expect(scorePanel().getByText(/Transformer too small/)).toBeTruthy();
    expect(screen.getAllByText(/OVERHEATED/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Fix the design' }));
    pick('tx-kva', '100');
    expect(screen.getByText(/Busiest phase: 208 % of this size/)).toBeTruthy(); // bigger is not enough: all on L1
    ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].forEach((id, i) => pick(`ph-${id}`, `L${(i % 3) + 1}`));
    ['1', '2', '3'].forEach(n => { pick(`ph-SCH-${n}`, `L${n}`); pick(`ph-SHP-${n}`, `L${n}`); });
    expect(screen.getByText(/Busiest phase: 69 % of this size/)).toBeTruthy();
    runAndSkip();
    expect(scorePanel().queryByText(/Transformer too small/)).toBeNull();
  });

  it('offers label modes everywhere and a floor choice for the building', async () => {
    localStorage.setItem('power-sim:progress:v1', JSON.stringify({
      ...STARTER_DONE, 'level-1-villa': { score: 905, stars: 3 }, 'level-2-two-villas': { score: 800, stars: 2 },
    }));
    render(<App />);
    await screen.findByRole('button', { name: 'Run the day' });
    fireEvent.click(screen.getByRole('button', { name: /Level 3/ }));
    await openInstallerWiring();
    const labels = within(await screen.findByRole('group', { name: 'Labels' }));
    expect(labels.getByRole('button', { name: 'Smart' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(labels.getByRole('button', { name: 'All' }));
    expect(labels.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('group', { name: 'Floors' })).toBeNull(); // one-storey villa

    fireEvent.click(screen.getByRole('button', { name: /Level 5/ }));
    const floors = within(await screen.findByRole('group', { name: 'Floors' }));
    fireEvent.click(floors.getByRole('button', { name: '1' }));
    expect(floors.getByRole('button', { name: '1' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows level file problems instead of a blank screen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"project":"x"}', { status: 200 })));
    render(<App />);
    expect(await screen.findByText(/Level file is not valid/)).toBeTruthy();
  });
});
