import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'
import unusedImports from 'eslint-plugin-unused-imports'

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'public/sw.js',
      'public/workbox-*.js',
      '*.config.js',
      '*.config.mjs',
      'next-env.d.ts',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      // Sprint Cleanup-I8 / Lot 6 (2026-05-14) — activation globale après
      // sweep final des 3 routes monthly-recap stateful. console.warn/error
      // restent allow-listés (intentional ad-hoc logging), tout autre
      // console.* est désormais une error globale.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: [
      'proxy.ts',
      'lib/expense-allocation.ts',
      'lib/logger.ts',
      'app/api/auth/**',
      'app/api/groups/**',
      'app/api/profile/**',
      'app/api/savings/**',
      'app/api/bank-balance/**',
      'lib/api/finance/**',
      'lib/finance/**',
      'app/api/finance/**',
      'components/**',
      'hooks/**',
      'contexts/**',
      'app/dashboard/page.tsx',
      'app/inscription/page.tsx',
      'app/reset-password/page.tsx',
      'app/forgot-password/page.tsx',
      'lib/auth.ts',
      'lib/session.ts',
      'lib/session-server.ts',
      'lib/supabase-client.ts',
      'lib/api/with-auth.ts',
      'app/auth/**',
      'app/api/debug/**',
      'lib/debug-guard.ts',
      'lib/api/parse-body.ts',
      'lib/schemas/**',
    ],
    rules: { 'no-console': 'error' },
  },
  {
    // CLI scripts legitimately write status / progress to stdout via console.log.
    // The global no-console rule targets app code, not dev tooling.
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
]

export default eslintConfig
