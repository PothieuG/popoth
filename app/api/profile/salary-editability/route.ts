import { NextResponse } from 'next/server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { canEditSalary } from '@/lib/finance/planner-emptiness'
import { logger } from '@/lib/logger'

export interface SalaryEditabilityResponse {
  editable: boolean
  reason: 'planner-not-empty' | null
}

/**
 * GET /api/profile/salary-editability — true ssi le planificateur du user
 * est complètement vierge (Sprint Salary-Edit-Gating). Solo : check rows
 * profile_id = userId. En groupe : check rows perso + rows groupe ensemble.
 *
 * Le wizard recap (POST /api/monthly-recap/update-salaries) n'est pas
 * gated par cet endpoint — c'est l'autre voie autorisée pour mettre à jour
 * le salaire.
 */
export const GET = withAuthAndProfile(async (_request, { profile }) => {
  try {
    const result = await canEditSalary(profile)
    return NextResponse.json({ data: result satisfies SalaryEditabilityResponse })
  } catch (error) {
    logger.error('Erreur lors du check salary-editability:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
