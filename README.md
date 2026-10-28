# Power Sim

A learning game about electrical power distribution. The player runs the power for a place that grows:
one villa first, then two villas, a building, a village and a city. Good choices earn points, mistakes cost points.

| Level | What you learn |
|---|---|
| 1 · One villa | Breaker and cable sizing, daily load profiles, solar |
| 2 · Two villas | Three-phase supply, phase balance, feeder cables, voltage drop over distance |
| 3 · Apartment building | Main board, floor boards on a riser, flats on phases, short circuits and which breaker trips |

A level opens once the one before it has at least one star. Best results are kept in the browser.

Every level sits in a small village: a street with pavements and lamps that light up at dusk, palms and shade trees,
lawns and footpaths, and a pond with reeds and ripples. The scenery is decoration only; it never changes the results.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

| Command | What it does |
|---|---|
| `npm run dev` | Start the game with live reload |
| `npm test` | Simulation unit tests |
| `npm run typecheck && npm run lint && npm test` | Full check (same as CI) |
| `npm run build` | Static build in `dist/` |

## How to play (Level 1)

The villa was wired with a few mistakes. Your job is to find and fix them.

1. **Design.** Pick a breaker and cable for each room, the main breaker and the solar size. Learn mode shows
   each room's highest current. The rule to follow: **room current ≤ breaker ≤ cable**. Watch the budget.
2. **Run the day.** The day replays from 00:00 to 24:00. Rooms glow green, orange or red with their loading,
   and the event list shows trips as they happen.
3. **Result.** You get up to 1000 points and 3 stars. Each mistake gets a short card that says what went wrong and how to fix it.

| Points | For |
|---|---|
| 400 | Power kept on (energy supplied ÷ energy asked for) |
| 250 | Safe design: −125 for each breaker bigger than its cable |
| 150 | Healthy loading: −50 for each breaker above 90 % at peak |
| 100 | Within budget (all lost at 25 % over) |
| 100 | Solar share of the day's energy (full at 30 %) |

3 stars need 900 points and no mistakes. Before the run you can still explore: drag the time slider, rotate the villa,
show the roof, or click a room to see inside.

The **Labels** buttons on the 3D view choose how much text it shows: *Smart* (the default) shows only rooms that need
attention plus the room under the pointer, *All* shows every room, and *Off* hides room labels. In a building,
**Floors** hides the upper floors so you can look into the lower ones.

## Level 2

Two villas share a three-phase supply from a feeder pillar. Every room starts on L1, and Villa B is 85 m away on a feeder
cable that is too small for its breaker. Spread the rooms over L1, L2 and L3 (the design panel shows each board's
phase currents at its busiest time), size the feeders, and keep every room within 5 % of the supply voltage.

Level 2 scores supply 300, safety 200, healthy loading 100, voltage 150, balanced phases 150 and budget 100.

## Level 3

A main board feeds a board on each of two floors through a riser, and each floor board feeds three single-phase flats.
Every flat starts on L1, the floor 2 riser cable is too small for its breaker, and at 19:30 a kettle lead shorts in
flat 2B's kitchen. Only the kitchen breaker should open, at once.

In a short circuit the current is the supply voltage divided by the resistance of the supply and every cable on the way.
A room breaker trips at once from 5 × its rating, a board breaker from 10 ×. So the room breaker should be small enough
to trip at once, and the boards above it big enough (on cables that can carry them) not to. The design panel shows the
expected short-circuit current at the room and each board's instant-trip current.

Level 3 scores supply 250, safety 150, healthy loading 100, voltage 100, balanced phases 100, short circuit handled 200 and budget 100.

## Level files

Levels live in `public/data/`. Level 1 uses a short villa format (`supply.mainBreakerA`, `solarKw`, `circuits`).
Other levels list `boards` (each with `parent`, `breakerA`, `phases` and a feeder `cable` of `mm2` and `lengthM`)
and `circuits` with `board`, `phase` and `lengthM`. A single-phase board on a three-phase parent sets its own `phase`,
and `floor` stacks boards with rooms into storeys. `faults` lists short circuits (`hour`, `circuit`, `text`), and
`supply.sourceOhms` sets the supply's own resistance. `points` sets which score parts a level uses.
`parseLevel` checks every file and lists all problems it finds.

## Layout

```
public/data/villa.json   level file
src/sim/                 simulation: pure TypeScript, no Three.js, React or DOM
  types.ts, parse.ts     level format and validation
  profiles.ts            24-hour demand profiles per load type
  sun.ts                 sun position and solar output
  breaker.ts             simple breaker: heats when overloaded, trips at once on a short circuit
  network.ts             supply tree (grid → boards → loads) with per-phase currents, ready for transformers
  simulate.ts            Simulator: setHour / advance / result
  cables.ts              cable sizes, the current each can carry, and voltage drop
src/game/                game rules: pure TypeScript, like src/sim
  catalog.ts             equipment choices and prices
  runDay.ts              scored day: frames, events, energy, peaks
  score.ts               points, stars and lesson cards
  hints.ts               Learn mode: each room's highest current
src/render/SiteScene.ts  Three.js site: villas, flats, feeder pillar, riser, cables. Reads results only.
src/render/Landscape.ts  street, lamps, trees, lawns and pond (landscapeLayout.ts places them, tested)
src/ui/                  React HUD and app shell
```

`src/sim` and `src/game` are the parts that will run inside LV Design Studio as a plugin. ESLint blocks rendering and UI imports in them.

## Simple model (on purpose)

- Room current = kW ÷ (230 V × power factor). Power factor 0.9 for AC, 0.95 for lighting and sockets.
- Phase currents are added as plain numbers (no phase angles). A board breaker sees its busiest phase.
- Voltage drop uses copper resistance only: both conductors on single-phase runs, one conductor per phase on three-phase feeders.
- Phases count as unbalanced when the quietest phase is more than 25 % below the busiest at the board's peak.
- Short-circuit current uses resistance only (supply plus phase and neutral of every cable). If no breaker trips at once,
  the one that heats up first opens, and the fault counts as not cleared at once.
- Sun rises at 06:00, sets at 18:00 and peaks at 55°. Solar output = kWp × 0.85 × sun height.
- Solar connects at the DB and stops when the main breaker trips.
- Cable ratings are rounded game values for copper cable in a wall: 1.5 mm² 16 A, 2.5 mm² 24 A, 4 mm² 32 A, 6 mm² 40 A, 10 mm² 55 A.
- Prices are game credits, not real money.
