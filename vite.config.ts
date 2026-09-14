/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

// Vite + Vitest единым конфигом.
// base './' — чтобы dist можно было открывать и как статику, и через preview.
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
