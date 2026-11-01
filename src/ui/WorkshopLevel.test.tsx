// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const LEVEL_FILE = readFileSync(resolve(process.cwd(), 'public/data/villa.json'), 'utf8');

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(LEVEL_FILE, { status: 200 })));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const click = (id: string) => fireEvent.click(document.getElementById(id)!);
/** Parts get ids in the order they are placed. */
const wire = (from: string, to: string) => { click(`term-${from}`); click(`term-${to}`); };
const powerOn = () => {
  click('power-on');
  fireEvent.click(screen.getByRole('button', { name: 'Skip to result' }));
};
const coins = () => document.querySelector('.coins-line b')!.textContent;

describe('Level 1: single circuit', () => {
  const place = () => { click('tray-battery'); click('tray-switch'); click('tray-lamp'); };

  it('starts a new player here, with nothing running', () => {
    render(<App />);
    expect(screen.getByText(/Single circuit · Workshop/)).toBeTruthy();
    expect(screen.getByText(/Drag a part here/)).toBeTruthy();
    expect(coins()).toBe('20 coins');
    expect((screen.getByRole('button', { name: /Level 2/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('takes a player from building to 3 stars, coins and the next level', async () => {
    render(<App />);
    place();
    wire('battery1-a', 'switch2-a');
    wire('switch2-b', 'lamp3-a');
    wire('lamp3-b', 'battery1-b');
    expect(document.querySelectorAll('.wire')).toHaveLength(3);

    powerOn();
    expect(screen.getByText('It held!')).toBeTruthy();
    expect(within(document.querySelector<HTMLElement>('.panel.score')!).getByLabelText('3 of 3 stars')).toBeTruthy();
    expect(screen.getByText('+60 coins')).toBeTruthy();
    expect(coins()).toBe('80 coins');
    expect(document.querySelector('.world-map li.lit')!.textContent).toBe('Circuit');

    click('next-level');
    expect(await screen.findByText(/One room · Workshop/)).toBeTruthy();
    expect(coins()).toBe('80 coins');
  });

  it('shows the failure and a tip, then lets the player fix it for no coins', () => {
    render(<App />);
    place();
    wire('battery1-a', 'lamp3-a');
    click('power-on');
    fireEvent.click(screen.getByRole('button', { name: 'Skip to result' }));
    expect(screen.getByText('It did not hold')).toBeTruthy();
    expect(screen.getByText(/closed loop/)).toBeTruthy();
    expect(screen.queryByText(/\+\d+ coins/)).toBeNull();
    expect(coins()).toBe('20 coins');

    click('fix-build');
    expect(document.querySelectorAll('.part')).toHaveLength(3); // the build is kept
    expect(document.querySelectorAll('.wire')).toHaveLength(1);
  });

  it('pays once for each star, however often a level is replayed', () => {
    render(<App />);
    place();
    wire('battery1-a', 'switch2-a');
    wire('switch2-b', 'lamp3-a');
    wire('lamp3-b', 'battery1-b');
    powerOn();
    click('fix-build');
    powerOn();
    expect(screen.queryByText(/\+\d+ coins/)).toBeNull();
    expect(coins()).toBe('80 coins');
  });

  it('asks for parts when Power On is pressed on an empty board', () => {
    render(<App />);
    click('power-on');
    expect(screen.getByText(/Place the battery/)).toBeTruthy();
  });

  it('removes a selected part and its wires, and cancels a wire with one click', () => {
    render(<App />);
    place();
    wire('battery1-a', 'lamp3-a');
    fireEvent.pointerDown(document.getElementById('part-lamp3')!, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }));
    expect(document.querySelectorAll('.part')).toHaveLength(2);
    expect(document.querySelectorAll('.wire')).toHaveLength(0);

    click('term-battery1-a');
    click('term-battery1-a');
    expect(document.querySelector('.term.pending')).toBeNull();
    expect(document.querySelectorAll('.wire')).toHaveLength(0);
  });

  it('makes a wire by dragging between two circles, with a preview, and marks both as connected', () => {
    render(<App />);
    place();
    expect(screen.getByText(/Drag from one circle to another with the same number/)).toBeTruthy();
    const from = document.getElementById('term-battery1-a')!, to = document.getElementById('term-switch2-a')!;
    document.elementFromPoint = () => to;

    fireEvent(from, new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 100, clientY: 40 }));
    expect(document.querySelector('.wire-preview')).toBeTruthy();
    fireEvent(window, new MouseEvent('pointerup', { clientX: 200, clientY: 40 }));

    expect(document.querySelector('.wire-preview')).toBeNull();
    expect(document.querySelectorAll('.wire')).toHaveLength(1);
    expect(from.className).toContain('wired');
    expect(to.className).toContain('wired');
    expect(document.querySelector('.term.pending')).toBeNull();
    expect(screen.queryByText(/Drag from one circle to another/)).toBeNull();
  });

  it('makes no wire when a drag ends away from any circle', () => {
    render(<App />);
    place();
    document.elementFromPoint = () => document.querySelector('.board');
    fireEvent(document.getElementById('term-battery1-a')!, new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 100, clientY: 40 }));
    fireEvent(window, new MouseEvent('pointerup', { clientX: 100, clientY: 40 }));
    expect(document.querySelectorAll('.wire')).toHaveLength(0);
    expect(document.querySelector('.term.pending')).toBeNull();
  });

  it('moves a part with the keyboard', () => {
    render(<App />);
    click('tray-lamp');
    const part = document.getElementById('part-lamp1')!;
    const before = part.style.left;
    fireEvent.keyDown(part, { key: 'ArrowRight' });
    expect(part.style.left).not.toBe(before);
  });

  it('spends coins on a hint and keeps it', () => {
    render(<App />);
    click('buy-hint');
    expect(coins()).toBe('5 coins');
    expect(screen.getByText(/Battery \+ to switch IN/)).toBeTruthy();
    expect((document.getElementById('buy-warm-lamps') as HTMLButtonElement).disabled).toBe(true); // 5 coins is not enough
    cleanup();
    render(<App />);
    expect(screen.getByText(/Battery \+ to switch IN/)).toBeTruthy();
    expect(coins()).toBe('5 coins');
  });
});

describe('Level 2: one room', () => {
  beforeEach(() => {
    localStorage.setItem('power-sim:progress:v1', JSON.stringify({ 'level-circuit': { score: 3, stars: 3 } }));
  });
  const place = () => { click('tray-supply'); click('tray-breaker'); click('tray-light'); click('tray-socket'); click('tray-lbar'); click('tray-nbar'); };
  const wireRoom = () => {
    wire('supply1-a', 'breaker2-a');
    wire('breaker2-b', 'lbar5-a');
    wire('lbar5-b', 'light3-a');
    wire('lbar5-d', 'socket4-a');
    wire('light3-b', 'nbar6-a');
    wire('socket4-b', 'nbar6-c');
    wire('nbar6-b', 'supply1-b');
  };
  const size = (a: string) => fireEvent.change(document.getElementById('size-breaker2')!, { target: { value: a } });

  it('trips a breaker that is too small, then earns 3 stars once fixed', () => {
    render(<App />);
    expect(screen.getByText(/One room · Workshop/)).toBeTruthy();
    place();
    wireRoom();
    expect(screen.getByText('120 / 140 credits').textContent).toBeTruthy();
    powerOn(); // the breaker starts at its smallest size
    expect(screen.getByText('It did not hold')).toBeTruthy();
    expect(screen.getByText(/through a 6 A breaker/)).toBeTruthy();

    click('fix-build');
    size('20');
    powerOn();
    const panel = within(document.querySelector<HTMLElement>('.panel.score')!);
    expect(panel.getByLabelText('3 of 3 stars')).toBeTruthy();
    expect(panel.getByText(/the breaker opens at once/)).toBeTruthy();
    expect(screen.getByText(/That was the fault test/)).toBeTruthy();
    expect(screen.getByText(/safe trip/)).toBeTruthy();
  });

  it('warns about thin cable, and changes a selected wire when a size is picked', () => {
    render(<App />);
    place();
    size('20');
    click('cable-1.5');
    wireRoom();
    powerOn();
    expect(within(document.querySelector<HTMLElement>('.panel.score')!).getByLabelText('1 of 3 stars')).toBeTruthy();
    expect(screen.getByText(/20 A breaker on 1.5 mm²/)).toBeTruthy();

    click('fix-build');
    expect(screen.getByText('85 / 140 credits')).toBeTruthy();
    fireEvent.pointerDown(document.querySelector('.wire .wire-hit')!);
    click('cable-2.5');
    expect(screen.getByText('90 / 140 credits')).toBeTruthy();
  });
});
