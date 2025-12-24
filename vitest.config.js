import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://localhost:3000',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? 'test-key'
    }
  }
})
