// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// jsdom gives import.meta.url an http scheme, so read the level from the project root
const file = (name: string) => readFileSync(resolve(process.cwd(), 'public/data', name), 'utf8');
const LEVEL_FILES: Record<string, string> = { 'villa.json': file('villa.json'), 'two-villas.json': file('two-villas.json') };

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

  it('shows level file problems instead of a blank screen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"project":"x"}', { status: 200 })));
    render(<App />);
    expect(await screen.findByText(/Level file is not valid/)).toBeTruthy();
  });
});
