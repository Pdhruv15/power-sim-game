import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Simulation and game rules are the future LV Design Studio plugin core: no rendering or UI code in them.
    files: ['src/sim/**/*.ts', 'src/game/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['three', 'three/*', 'react', 'react-dom', 'react-dom/*', '../render/*', '../ui/*', '**/render/**', '**/ui/**'],
          message: 'src/sim and src/game must stay free of rendering and UI code.',
        }],
      }],
    },
  },
);
