import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { include: ['src/**/__tests__/**/*.test.ts'], passWithNoTests: true },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
