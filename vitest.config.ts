import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

// Load .env.local so gated integration tests can read NEXT_PUBLIC_SUPABASE_URL
// / SUPABASE_SERVICE_ROLE_KEY without forcing callers to export them manually
// each run. Pure-unit tests are unaffected. Inline loader avoids a `vite`
// devDependency just for loadEnv.
function loadDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    const key = m?.[1]
    let v = m?.[2]
    if (!key || v === undefined) continue
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[key] = v
  }
  return out
}
const env = loadDotEnv(path.resolve(__dirname, '.env.local'))

export default defineConfig({
  test: {
    exclude: ['node_modules/**', '.next/**', 'dist/**'],
    env,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['**/*.test.ts'],
          exclude: ['node_modules/**', '.next/**', 'dist/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['**/*.test.tsx'],
          exclude: ['node_modules/**', '.next/**', 'dist/**'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
