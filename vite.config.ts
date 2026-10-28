import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build also runs from a sub-folder (e.g. inside LV Design Studio later).
export default defineConfig({
  base: './',
  plugins: [react()],
  // Three.js alone is ~600 kB minified; that is expected for this app.
  build: { chunkSizeWarningLimit: 800 },
});
