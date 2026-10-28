// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// jsdom gives import.meta.url an http scheme, so read the level from the project root
const LEVEL = readFileSync(resolve(process.cwd(), 'public/data/villa.json'), 'utf8');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(LEVEL, { status: 200 })));
  // jsdom has no WebGL: the 3D view shows its fallback message and the rest of the game still runs.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const pick = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } });
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
    expect(screen.getByText('745')).toBeTruthy();
    expect(screen.getByLabelText('1 of 3 stars')).toBeTruthy();
    expect(screen.getByText(/Breaker too small: Bedroom 2/)).toBeTruthy();
    expect(screen.getByText(/Breaker bigger than the cable: Kitchen/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Fix the design' }));
    pick('cab-C4', '2.5');
    pick('brk-C5', '20');
    pick('brk-C6', '16');
    pick('cab-C6', '2.5');
    pick('main-breaker', '80');
    expect(screen.getByText(/1040 \/ 1100 credits/)).toBeTruthy();

    runAndSkip();
    expect(screen.getByText('955')).toBeTruthy();
    expect(screen.getByLabelText('3 of 3 stars')).toBeTruthy();
    expect(screen.getByText(/Power stayed on all day/)).toBeTruthy();
  });

  it('shows level file problems instead of a blank screen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"project":"x"}', { status: 200 })));
    render(<App />);
    expect(await screen.findByText(/Level file is not valid/)).toBeTruthy();
  });
});
