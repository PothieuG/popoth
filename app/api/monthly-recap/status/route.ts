import { NextResponse } from 'next/server'
import { checkRecapStatus, RecapStatusError, type RecapContext } from '@/lib/recap/check-status'
import { withAuth } from '@/lib/api/with-auth'

/**
 * API GET /api/monthly-recap/status
 *
 * Vérifie si un récapitulatif mensuel est requis pour l'utilisateur.
 * Logique métier dans lib/recap/check-status.ts (réutilisée par le middleware
 * en appel direct sans aller-retour HTTP).
 */
export const GET = withAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url)
    const rawContext = searchParams.get('context') || 'profile'

    if (rawContext !== 'profile' && rawContext !== 'group') {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 },
      )
    }

    const context: RecapContext = rawContext

    const status = await checkRecapStatus(userId, context)

    console.log(`📅 [Monthly Recap Status] Context: ${context}, User: ${userId}`)
    console.log(`📅 [Monthly Recap Status] Date: ${status.currentMonth}/${status.currentYear}`)
    console.log(
      `📅 [Monthly Recap Status] Required: ${status.required} (Has existing: ${status.hasExistingRecap})`,
    )

    return NextResponse.json(status)
  } catch (error) {
    if (error instanceof RecapStatusError) {
      const httpStatus = error.code === 'PROFILE_NOT_FOUND' ? 404 : 400
      return NextResponse.json({ error: error.message }, { status: httpStatus })
    }

    console.error('❌ Erreur lors de la vérification du statut du récap mensuel:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
