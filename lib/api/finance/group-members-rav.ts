import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { loadGroupMembersRav } from '@/lib/finance'
import { withAuthAndGroup } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'

/**
 * GET /api/finance/group-members-rav — RAV courant de chaque membre du groupe
 * de l'utilisateur.
 *
 * Sprint Perf-Group-Members-Rav-Lazy (2026-09-10). Ces lignes étaient servies
 * par `GET /api/finance/summary?context=group` via `meta.groupMembersRav`, ce
 * qui faisait payer un `getProfileFinancialData` complet par membre à CHAQUE
 * chargement du dashboard groupe — alors que le seul consommateur est l'encart
 * « RAV actuel → projeté » des modals du drawer Planification.
 *
 * Le drawer ne requête donc cette route qu'à son ouverture
 * (`hooks/useGroupMembersRav.ts`, `enabled: isOpen && context === 'group'`).
 *
 * Utilisateur sans groupe → `{ data: [] }` (200). Ce n'est pas une erreur :
 * l'appelant est un composant partagé perso/groupe, et un tableau vide est
 * exactement ce qu'il doit afficher.
 */
export const GET = withAuthAndGroup(async (_request: NextRequest, { groupId }) => {
  try {
    if (!groupId) {
      return NextResponse.json({ data: [] })
    }

    return NextResponse.json({ data: await loadGroupMembersRav(groupId) })
  } catch (error) {
    logger.error('Erreur dans GET /api/finance/group-members-rav:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
