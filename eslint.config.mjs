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
      'no-console': ['warn', { allow: ['warn', 'error'] }],
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
      'middleware.ts',
      'lib/expense-allocation.ts',
      'lib/logger.ts',
      'app/api/auth/**',
      'app/api/groups/**',
      'app/api/monthly-recap/{status,refresh,resume,initialize,step1-data,step2-data,accumulate-piggy-bank,transfer,update-step,recover}/**',
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
      'app/monthly-recap/page.tsx',
      'app/inscription/page.tsx',
      'app/reset-password/page.tsx',
      'app/forgot-password/page.tsx',
      'lib/auth.ts',
      'lib/session.ts',
      'lib/session-server.ts',
      'lib/supabase-client.ts',
      'lib/database-snapshot.ts',
      'lib/api/with-auth.ts',
      'app/auth/**',
      'app/api/debug/**',
      'lib/debug-guard.ts',
      // Sprint Refactor-I5 (2026-05-11) — process-step1 god file extraction.
      // `lib/recap/check-status.ts` is intentionally NOT escalated (pre-Sprint
      // I5 module, may grow benign console.* later); scope only the step1-* +
      // route extraction so any regression sorts the PR red.
      'app/api/monthly-recap/process-step1/**',
      'lib/recap/step1-algorithm.ts',
      'lib/recap/step1-persist.ts',
      'lib/recap/types.ts',
      'lib/recap/index.ts',
      'lib/api/parse-body.ts',
      'lib/schemas/**',
    ],
    rules: { 'no-console': 'error' },
  },
]

export default eslintConfig
