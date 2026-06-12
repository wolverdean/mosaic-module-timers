import { defineConfig }  from 'vitest/config'
import path              from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@mosaic/sdk': path.resolve(__dirname, '../mosaic-framework/types.ts'),
    },
  },
  test: {
    include:     ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include:  ['src/**/*.ts'],
      exclude:  ['tests/**', 'dist/**'],
    },
  },
})
