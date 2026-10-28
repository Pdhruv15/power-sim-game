# Power Sim

A learning game about electrical power distribution. The player runs the power for a place that grows:
one villa first, then two villas, a building, a village and a city. Good choices earn points, mistakes cost points.

This first version is **Level 1, one villa**: a 3D villa runs through a day, and each circuit's load,
the solar output and the grid import change with the time.

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

- Drag to rotate, scroll to zoom, right-drag to pan. Click a room (or its row) to see inside.
- Move the time slider or press **Play** (one hour per second).
- Room glow and cables show breaker loading: green below 60 %, orange 60–90 %, red above 90 %.
- Above 100 % a breaker heats up and trips after a while. Big overloads trip fast. **Reset breakers** turns them back on.
- The level file is `public/data/villa.json`. Edit it and reload to try another villa.

## Layout

```
public/data/villa.json   level file
src/sim/                 simulation: pure TypeScript, no Three.js, React or DOM
  types.ts, parse.ts     level format and validation
  profiles.ts            24-hour demand profiles per load type
  sun.ts                 sun position and solar output
  breaker.ts             simple breaker: heats when overloaded, trips at once on a short circuit
  network.ts             supply tree (grid → board → loads), ready for transformers later
  simulate.ts            Simulator: setHour / advance / result
src/render/              Three.js scene. Reads results only.
src/ui/                  React HUD and app shell
```

`src/sim` is the part that will run inside LV Design Studio as a plugin. ESLint blocks rendering and UI imports in it.

## Simple model (on purpose)

- Single-phase supply. Current = kW ÷ (voltage × power factor). Power factor 0.9 for AC, 0.95 for lighting and sockets.
- Sun rises at 06:00, sets at 18:00 and peaks at 55°. Solar output = kWp × 0.85 × sun height.
- Solar connects at the DB and stops when the main breaker trips.
