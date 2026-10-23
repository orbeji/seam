import { defineConfig } from 'vitest/config'

/**
 * Separate from the unit and integration configs on purpose: the end-to-end
 * tests launch the built Electron application, so they need a build first and a
 * display. `npm test` never picks them up; `npm run test:e2e` does.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false
  }
})
