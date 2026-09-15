/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

// Vite + Vitest единым конфигом.
// base './' — чтобы dist можно было открывать и как статику, и через preview.
export default defineConfig({
  base: './',
  server: {
    port: 5173, strictPort: false,
    // Атомарные сохранения редактора пложают временные *.tmpdir/*.tmp рядом с файлами —
    // fs-watcher падает на них с EBUSY. Игнорируем мусор, следим только за реальными файлами.
    watch: { ignored: ['**/.*tmpdir/**', '**/*.tmp'] },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
