// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildView } from '../render/SiteScene';
import { App } from './App';

// jsdom has no WebGL, so a stand-in scene records what the game asks it to show
const scenes = vi.hoisted(() => [] as { onPick: (kind: 'room' | 'board', id: string) => void; onMiss: () => void; views: BuildView[] }[]);
vi.mock('../render/SiteScene', () => ({
  SiteScene: class {
    onPick: (kind: 'room' | 'board', id: string) => void = () => {};
    onMiss = () => {};
    onRoomClick = () => {};
    views: BuildView[] = [];
    constructor() { scenes.push(this); }
    update() {}
    setRoofVisible() {}
    setFaded() {}
    setLabelMode() {}
    setFloorLimit() {}
    setBuildView(v: BuildView | null) { if (v) this.views.push(v); }
    dispose() {}
  },
}));

const villa = readFileSync(resolve(process.cwd(), 'public/data/villa.json'), 'utf8');
const click = (id: string) => fireEvent.click(document.getElementById(id)!);
const lastView = () => scenes[scenes.length - 1].views.at(-1)!;

beforeEach(() => {
  scenes.length = 0;
  localStorage.clear();
  localStorage.setItem('power-sim:progress:v1', JSON.stringify({ 'level-circuit': { score: 3, stars: 3 }, 'level-room': { score: 3, stars: 3 } }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(villa, { status: 200 })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Building the villa in 3D', () => {
  it('opens in 3D, and can switch to the diagram and back', async () => {
    render(<App />);
    await screen.findByText('0 of 8 rooms wired');
    expect(document.getElementById('view-3d')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('term-street')).toBeNull();
    expect(lastView().ghostBoards).toBe(false);
    click('view-diagram');
    expect(document.getElementById('term-street')).toBeTruthy();
    click('view-3d');
    expect(document.getElementById('tool-supply')).toBeTruthy();
  });

  it('builds with parts in hand: board, street cable, then a cable to each room clicked', async () => {
    render(<App />);
    await screen.findByText('0 of 8 rooms wired');
    const status = () => screen.getByRole('status').textContent;

    click('tool-cable-2.5');
    expect(lastView().targets).toBe('rooms');
    click('pick-C1');
    expect(status()).toBe('Place the Villa DB first. The rooms get their power through it.');

    click('tool-board-DB');
    expect(lastView().ghostBoards).toBe(true);
    click('pick-C3');
    expect(lastView().boards.DB.placed).toBe(true);
    expect((document.getElementById('tool-board-DB') as HTMLButtonElement).disabled).toBe(true);

    click('tool-supply');
    expect(lastView().targets).toBe('boards');
    click('pick-board-DB');
    expect(lastView().supplyWired).toBe(true);

    click('tool-cable-2.5');
    for (const id of ['C1', 'C2', 'C3']) click(`pick-${id}`);
    act(() => scenes[scenes.length - 1].onPick('room', 'C4')); // a click on the room in the 3D view
    expect(screen.getByText('4 of 8 rooms wired')).toBeTruthy();
    expect(lastView().rooms.C4).toEqual({ wired: true, text: '6 A · 2.5 mm²' });
    expect(document.getElementById('pick-C4')!.className).toContain('on');

    act(() => scenes[scenes.length - 1].onMiss()); // a click on the lawn
    expect(status()).toBe('Click inside the house: a room, or the board at the end of the corridor.');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.getElementById('tool-cable-2.5')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('picks a room to change its sizes, and runs the day once every room is wired', async () => {
    render(<App />);
    await screen.findByText('0 of 8 rooms wired');
    click('tool-board-DB');
    click('pick-C1');
    click('tool-supply');
    click('pick-board-DB');
    click('tool-cable-2.5');
    for (let i = 1; i <= 8; i++) click(`pick-C${i}`);
    click('tool-cable-2.5'); // put it down

    click('pick-C4');
    const card = within(screen.getByRole('region', { name: 'Kitchen' }));
    expect(card.getByText(/up to .* A at/)).toBeTruthy();
    fireEvent.change(document.getElementById('brk-C4')!, { target: { value: '20' } });
    expect(lastView().rooms.C4.text).toBe('20 A · 2.5 mm²');
    expect(lastView().selected).toBe('C4');
    fireEvent.change(document.getElementById('cable-C4')!, { target: { value: '' } });
    expect(screen.getByText('7 of 8 rooms wired')).toBeTruthy();
    fireEvent.change(document.getElementById('cable-C4')!, { target: { value: '4' } });

    click('pick-board-DB');
    fireEvent.change(document.getElementById('brk-DB')!, { target: { value: '80' } });
    expect(lastView().boards.DB.text).toBe('80 A');

    click('power-on');
    expect(await screen.findByText('Running the day')).toBeTruthy();
  });
});
