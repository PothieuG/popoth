import { notFound } from 'next/navigation'

import DevRecapV2Client from './DevRecapV2Client'

/**
 * Sprint Recap-V2-Dev-Tools (2026-05-22) — dev-only page to seed scenarios
 * and reset the V2 monthly recap. Gated server-side via NODE_ENV check
 * (mirror of `blockInProduction()` used by the underlying API routes —
 * defense in depth).
 */
export default function DevRecapV2Page() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <DevRecapV2Client />
}
