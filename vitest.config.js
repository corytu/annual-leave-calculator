import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Only unit-test src/utils here. E2E lives in /e2e and runs via Playwright,
    // component/UI tests are explicitly out of scope for this round (see test plan §2).
    include: ['src/utils/**/*.test.js'],
    coverage: {
      provider: 'v8',
      // Coverage is scoped to the pure-logic layer only (test plan §7).
      include: ['src/utils/**'],
      exclude: ['src/utils/**/*.test.js'],
      reporter: ['text', 'html', 'cobertura'],
    },
  },
})
