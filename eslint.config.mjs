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
      'app/api/groups/**',
      'app/api/monthly-recap/{status,refresh,resume,initialize,step1-data,step2-data,accumulate-piggy-bank,transfer,update-step}/**',
      'app/api/profile/**',
      'app/api/savings/**',
      'app/api/bank-balance/**',
      'lib/api/finance/**',
      'app/api/finance/**',
      'components/**',
      'hooks/**',
      'contexts/**',
      'app/dashboard/page.tsx',
      'app/monthly-recap/page.tsx',
      'app/inscription/page.tsx',
      'app/reset-password/page.tsx',
      'app/forgot-password/page.tsx',
    ],
    rules: { 'no-console': 'error' },
  },
]

export default eslintConfig
