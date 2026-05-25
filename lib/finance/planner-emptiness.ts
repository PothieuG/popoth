import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * Scope du check "planificateur vierge" : un user solo regarde uniquement
 * ses 4 tables filtrées profile_id. Un user en groupe regarde SES rows perso
 * ET LES rows du groupe (les deux scopes doivent être vides ensemble).
 *
 * Cf. règle produit Sprint Salary-Edit-Gating (2026-05-25) — le salaire ne
 * peut être modifié via Settings que si le planificateur est complètement
 * vierge, sinon l'autre voie autorisée est le wizard recap (sprint 08 V3).
 */
export type PlannerScope =
  | { type: 'profile'; profileId: string }
  | { type: 'group'; profileId: string; groupId: string }

const PLANNER_TABLES = [
  'estimated_budgets',
  'estimated_incomes',
  'real_expenses',
  'real_income_entries',
] as const

type PlannerTable = (typeof PLANNER_TABLES)[number]

async function countRowsForScope(table: PlannerTable, scope: PlannerScope): Promise<number> {
  const query = supabaseServer.from(table).select('id', { count: 'exact', head: true })

  if (scope.type === 'profile') {
    const { count, error } = await query.eq('profile_id', scope.profileId)
    if (error) {
      logger.error(`[planner-emptiness] count failed on ${table}:`, error)
      throw error
    }
    return count ?? 0
  }

  const { count, error } = await query.or(
    `profile_id.eq.${scope.profileId},group_id.eq.${scope.groupId}`,
  )
  if (error) {
    logger.error(`[planner-emptiness] count failed on ${table}:`, error)
    throw error
  }
  return count ?? 0
}

/**
 * Vrai ssi aucune ligne n'existe dans estimated_budgets, estimated_incomes,
 * real_expenses, real_income_entries pour le scope donné. Toutes les rows
 * comptent — y compris is_carried_over=true (décision user : "tant qu'il y
 * a une ligne dans ton dashboard, c'est pas vierge").
 */
export async function isPlannerEmpty(scope: PlannerScope): Promise<boolean> {
  const counts = await Promise.all(PLANNER_TABLES.map((t) => countRowsForScope(t, scope)))
  return counts.every((c) => c === 0)
}

/**
 * Decision wrapper consommé par GET /api/profile/salary-editability et par
 * le PUT /api/profile (server-side enforcement). Détermine le scope selon
 * profile.group_id puis appelle isPlannerEmpty.
 */
export async function canEditSalary(profile: {
  id: string
  group_id: string | null
}): Promise<{ editable: boolean; reason: 'planner-not-empty' | null }> {
  const scope: PlannerScope = profile.group_id
    ? { type: 'group', profileId: profile.id, groupId: profile.group_id }
    : { type: 'profile', profileId: profile.id }

  const empty = await isPlannerEmpty(scope)
  return empty ? { editable: true, reason: null } : { editable: false, reason: 'planner-not-empty' }
}
