import { NextResponse, type NextRequest } from 'next/server'

import { blockInProduction } from '@/lib/debug-guard'
import { listScenarios } from '@/lib/dev/recap-v2-scenarios'
import { validateSessionToken } from '@/lib/session-server'

/**
 * GET /api/debug/recap-v2/scenarios
 *
 * Sprint Recap-V2-Dev-Tools (2026-05-22). Returns the list of available
 * scenarios (key + label + description) for the dev UI to render. The full
 * setup payload is not exposed — it stays server-side, applied only when
 * the user POSTs /seed with a known key.
 *
 * Gated `blockInProduction()` — 404 in prod.
 */
export async function GET(request: NextRequest) {
  const blocked = blockInProduction()
  if (blocked) return blocked

  const session = await validateSessionToken(request)
  if (!session?.userId) {
    return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
  }

  return NextResponse.json({ data: listScenarios() })
}
