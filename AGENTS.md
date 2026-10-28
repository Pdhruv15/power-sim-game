# Power Sim development rules

Learning game for electrical power distribution. Vite + React 18 + Three.js + TypeScript + Vitest. Base branch: `main`.

- Keep `src/sim` free of Three.js, React and DOM code. It becomes the LV Design Studio plugin core.
- Rendering (`src/render`) and UI (`src/ui`) only read simulation results.
- Keep the network model general (grid → transformer → board → load) so village and city levels fit later.
- Keep electrical rules simple and in plain words. Do not name or quote published standards in the game.
- Learn mode first: explain each mistake in one or two short sentences.
- Add unit tests for every simulation change. Verify with `npm run typecheck && npm run lint && npm test`.
- One topic per branch and PR. Commit, push and open a PR; the user merges on GitHub.
