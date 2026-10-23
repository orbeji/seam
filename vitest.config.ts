import { configDefaults, defineConfig } from 'vitest/config'

/**
 * The unit suite. It never starts Git, Electron or another external program, so
 * it is the only suite that runs in CI. Tests that need a real repository or
 * the built application are named `*.integration.test.ts` or `*.e2e.ts` and run
 * locally with `npm run test:integration` and `npm run test:e2e`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'test/**/*.integration.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    passWithNoTests: true
  }
})
