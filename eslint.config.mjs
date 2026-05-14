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
      // Sprint Refactor-I6 (2026-05-14) — complete god file extraction.
      // Same scoping rationale as I5: escalate only the migrated scope so
      // any future console.* regression sorts the PR red. The remaining
      // hors-scope monthly-recap routes (balance, auto-balance) stay out
      // of this glob until their respective extraction sprint.
      'app/api/monthly-recap/complete/**',
      'lib/recap/complete-algorithm.ts',
      'lib/recap/complete-persist.ts',
      'lib/recap/complete-types.ts',
      // Sprint Cleanup-I8 / Lot 6 (2026-05-14) — sweep final monthly-recap
      // stateful routes. balance + auto-balance migrated to logger.* (5
      // KEEP+migrate consolidated in auto-balance, 0 KEEP in balance).
      // Closes the chantier console.log cleanup multi-sprint.
      'app/api/monthly-recap/balance/**',
      'app/api/monthly-recap/auto-balance/**',
    ],
    rules: { 'no-console': 'error' },
  },
]

export default eslintConfig
