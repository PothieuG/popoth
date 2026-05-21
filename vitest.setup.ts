import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Note: jest-axe `toHaveNoViolations` matcher is incompatible with vitest 4.x
// (uses Jest-specific `this.utils` API). We use `axe()` directly + assertions
// on `results.violations` in a11y-audit.test.tsx (Sprint Zod-Rollout v6 / Axe 5).

afterEach(() => {
  cleanup()
})
