import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // better-sqlite3 is a native addon: run in forks, not worker threads.
    pool: 'forks'
  }
})
