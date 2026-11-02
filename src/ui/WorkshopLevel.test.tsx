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
    expect(document.querySelector('.world-map li.lit .map-name')!.textContent).toBe('Circuit');

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
  const place = () => { click('tray-light'); click('tray-socket'); };
  const wireLoad = (load: string, mcb: string) => {
    wire(`${mcb}-b`, `${load}-a`);
    wire('nbar-b', `${load}-b`);
    wire('ebar-b', `${load}-c`);
  };
  const size = (id: string, a: string) => fireEvent.change(document.getElementById(`size-${id}`)!, { target: { value: a } });
  const stars = (n: number) => within(document.querySelector<HTMLElement>('.panel.score')!).getByLabelText(`${n} of 3 stars`);

  it('starts with the distribution board ready, and only the loads to place', () => {
    render(<App />);
    expect(document.querySelector('.db-box')).toBeTruthy();
    expect(document.querySelectorAll('.wire.fixed').length).toBeGreaterThan(0);
    for (const id of ['part-main', 'part-lbar', 'part-nbar', 'part-ebar', 'part-mcb1', 'part-mcb2', 'part-street']) expect(document.getElementById(id)).toBeTruthy();
    expect(document.querySelectorAll('.tray-item')).toHaveLength(2);
  });

  it('keeps the board in place when the player clears or tries to move it', () => {
    render(<App />);
    place();
    const before = document.getElementById('part-mcb1')!.style.left;
    fireEvent.keyDown(document.getElementById('part-mcb1')!, { key: 'ArrowRight' });
    expect(document.getElementById('part-mcb1')!.style.left).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Clear board' }));
    expect(document.getElementById('part-mcb1')).toBeTruthy();
    expect(document.getElementById('part-light1')).toBeNull();
  });

  it('trips a breaker that is too small, then earns 3 stars once fixed, and explains the fault test', () => {
    render(<App />);
    place();
    click('cable-1.5');
    wireLoad('light1', 'mcb2');
    click('cable-2.5');
    wireLoad('socket2', 'mcb1');
    expect(screen.getByText('105 / 110 credits')).toBeTruthy();
    powerOn(); // the breakers start at their smallest size
    expect(screen.getByText('It did not hold')).toBeTruthy();
    expect(screen.getByText(/through a 6 A breaker/)).toBeTruthy();

    click('fix-build');
    size('mcb1', '20');
    powerOn();
    expect(stars(3)).toBeTruthy();
    expect(screen.getByText(/the breaker opens at once/)).toBeTruthy();
    expect(screen.getByText(/That was the fault test/)).toBeTruthy();
    expect(screen.getByText(/safe trip/)).toBeTruthy();
  });

  it('warns about thin cable, and changes a selected wire when a size is picked', () => {
    render(<App />);
    place();
    size('mcb1', '20');
    click('cable-1.5');
    wireLoad('light1', 'mcb2');
    wireLoad('socket2', 'mcb1');
    powerOn();
    expect(stars(1)).toBeTruthy();
    expect(screen.getByText(/20 A breaker on 1.5 mm²/)).toBeTruthy();

    click('fix-build');
    expect(screen.getByText('90 / 110 credits')).toBeTruthy();
    fireEvent.pointerDown(document.querySelector('.wire:not(.fixed) .wire-hit')!);
    click('cable-2.5');
    expect(screen.getByText('95 / 110 credits')).toBeTruthy();
  });

  it('colours wires by conductor', () => {
    render(<App />);
    place();
    wireLoad('light1', 'mcb2');
    expect(document.querySelectorAll('.wire.cond-L').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.wire.cond-N').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.wire.cond-E').length).toBeGreaterThan(0);
  });
});
