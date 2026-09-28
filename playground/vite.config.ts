import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The playground imports the library by its package name, straight from source.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@brechtknecht/gooey': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
});
