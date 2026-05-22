import { NextResponse, type NextRequest } from 'next/server'

import { handleBadRequest, parseBody } from '@/lib/api/parse-body'
import { blockInProduction } from '@/lib/debug-guard'
import { applyScenario } from '@/lib/dev/apply-scenario'
import { logger } from '@/lib/logger'
import { seedRecapV2BodySchema } from '@/lib/schemas/debug'
import { validateSessionToken } from '@/lib/session-server'

/**
 * POST /api/debug/recap-v2/seed
 *
 * Sprint Recap-V2-Dev-Tools (2026-05-22). Wipes the caller's finances then
 * applies a declarative scenario (declared in
 * `lib/dev/recap-v2-scenarios.ts`). Returns a summary of what was inserted
 * + the new financial state (group_id, counts).
 *
 * Gated `blockInProduction()` — 404 in prod.
 */
export async function POST(request: NextRequest) {
  const blocked = blockInProduction()
  if (blocked) return blocked

  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }
    const userId = session.userId

    const { scenario } = await parseBody(request, seedRecapV2BodySchema)
    const result = await applyScenario(userId, scenario)

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? `Scénario "${scenario}" appliqué`
        : `Scénario "${scenario}" partiellement appliqué (voir errors)`,
      data: result,
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('[recap-v2/seed] failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne' },
      { status: 500 },
    )
  }
}
