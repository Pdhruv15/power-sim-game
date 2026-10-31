// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// jsdom gives import.meta.url an http scheme, so read the level from the project root
const file = (name: string) => readFileSync(resolve(process.cwd(), 'public/data', name), 'utf8');
const LEVEL_FILES: Record<string, string> = Object.fromEntries(['villa.json', 'two-villas.json', 'building.json', 'village.json'].map(n => [n, file(n)]));

beforeEach(() => {
  localStorage.clear();
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

describe('Level 1 flow', () => {
  it('runs the day, shows the mistakes, and gives 3 stars once fixed', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Run the day' });
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

  it('opens Level 2 once Level 1 has a star', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Run the day' });
    const level2 = screen.getByRole('button', { name: /Level 2/ }) as HTMLButtonElement;
    expect(level2.disabled).toBe(true);

    runAndSkip();
    expect(level2.disabled).toBe(false);
    fireEvent.click(level2);
    expect(await screen.findByText(/feeder pillar at the gate/)).toBeTruthy();
    expect(screen.getAllByText(/busiest at 18:00: L1 62 · L2 0 · L3 0 A/)).toHaveLength(2); // both villas

    runAndSkip();
    expect(scorePanel().getByText(/Main breaker too small/)).toBeTruthy();
    expect(scorePanel().getByText(/Phases unbalanced: Villa A/)).toBeTruthy();
  });

  it('plays Level 3 with the short-circuit hint', async () => {
    localStorage.setItem('power-sim:progress:v1', JSON.stringify({
      'level-1-villa': { score: 905, stars: 3 }, 'level-2-two-villas': { score: 800, stars: 2 },
    }));
    render(<App />);
    await screen.findByRole('button', { name: 'Run the day' });
    fireEvent.click(screen.getByRole('button', { name: /Level 3/ }));
    expect(await screen.findByText(/Short circuit here at 19:30: about 518 A/)).toBeTruthy();
    expect(document.getElementById('ph-2B')).toBeTruthy(); // each flat picks its phase

    runAndSkip();
    expect(scorePanel().getByText('513')).toBeTruthy();
    expect(scorePanel().getByText(/Too many breakers tripped: Kitchen/)).toBeTruthy();
  });

  it('plays Level 4 with a transformer choice', async () => {
    localStorage.setItem('power-sim:progress:v1', JSON.stringify({
      'level-1-villa': { score: 905, stars: 3 }, 'level-2-two-villas': { score: 800, stars: 2 }, 'level-3-building': { score: 800, stars: 2 },
    }));
    render(<App />);
    await screen.findByRole('button', { name: 'Run the day' });
    fireEvent.click(screen.getByRole('button', { name: /Level 4/ }));
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
      'level-1-villa': { score: 905, stars: 3 }, 'level-2-two-villas': { score: 800, stars: 2 },
    }));
    render(<App />);
    await screen.findByRole('button', { name: 'Run the day' });
    const labels = within(screen.getByRole('group', { name: 'Labels' }));
    expect(labels.getByRole('button', { name: 'Smart' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(labels.getByRole('button', { name: 'All' }));
    expect(labels.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('group', { name: 'Floors' })).toBeNull(); // one-storey villa

    fireEvent.click(screen.getByRole('button', { name: /Level 3/ }));
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
