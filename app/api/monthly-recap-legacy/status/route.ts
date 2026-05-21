import { NextResponse } from 'next/server'
import { checkRecapStatus, RecapStatusError } from '@/lib/recap/check-status'
import { withAuth } from '@/lib/api/with-auth'
import { parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { contextOnlyQuerySchema } from '@/lib/schemas/common'

/**
 * API GET /api/monthly-recap/status
 *
 * Vérifie si un récapitulatif mensuel est requis pour l'utilisateur.
 * Logique métier dans lib/recap/check-status.ts (réutilisée par le proxy
 * en appel direct sans aller-retour HTTP).
 */
export const GET = withAuth(async (request, { userId }) => {
  try {
    const { context } = parseQuery(request, contextOnlyQuerySchema)
    const status = await checkRecapStatus(userId, context)
    return NextResponse.json(status)
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    if (error instanceof RecapStatusError) {
      const httpStatus = error.code === 'PROFILE_NOT_FOUND' ? 404 : 400
      return NextResponse.json({ error: error.message }, { status: httpStatus })
    }
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
