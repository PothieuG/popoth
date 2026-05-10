/**
 * Lecture / écriture du Reste-À-Vivre persisté en base.
 *
 * Extrait de lib/financial-calculations.ts au chantier I4. Le RAV est
 * stocké dans `bank_balances.current_remaining_to_live` (par profile_id
 * ou group_id, mais jamais les deux).
 *
 * `getRavFromDatabase` garde sa signature externe `(profileId, groupId)`
 * pour ne pas casser les 2 consommateurs (lib/api/finance/rav.ts et
 * lib/api/finance/summary.ts) — la migration vers ContextFilter relève
 * du commit #9 de l'I4.
 *
 * `saveRavToDatabase` est appelé en interne par get*FinancialData après
 * chaque recalcul.
 */

import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * Persiste le RAV calculé pour un profile ou un groupe (jamais les deux).
 * Fail-soft : aucune exception n'est propagée — l'erreur est loggée et le
 * caller continue (le calcul a déjà été fait, le snapshot persisté n'est
 * pas critique pour le rendu utilisateur).
 */
export async function saveRavToDatabase(
  profileId: string | null,
  groupId: string | null,
  remainingToLive: number,
): Promise<void> {
  try {
    const updates = {
      current_remaining_to_live: remainingToLive,
      updated_at: new Date().toISOString(),
    }
    if (profileId) {
      const { error } = await supabaseServer
        .from('bank_balances')
        .update(updates)
        .eq('profile_id', profileId)
      if (error) logger.error('Error saving RAV to database (profile)', { profileId, error })
    } else if (groupId) {
      const { error } = await supabaseServer
        .from('bank_balances')
        .update(updates)
        .eq('group_id', groupId)
      if (error) logger.error('Error saving RAV to database (group)', { groupId, error })
    }
  } catch (error) {
    logger.error('Exception while saving RAV to database', { profileId, groupId, error })
  }
}

/**
 * Lit le RAV persisté pour un profile ou un groupe. Renvoie 0 si la ligne
 * `bank_balances` n'existe pas ou si la requête échoue (le caller fallback
 * sur un recalcul à la volée).
 */
export async function getRavFromDatabase(
  profileId: string | null,
  groupId: string | null,
): Promise<number> {
  try {
    if (profileId) {
      const { data, error } = await supabaseServer
        .from('bank_balances')
        .select('current_remaining_to_live')
        .eq('profile_id', profileId)
        .single()
      if (error) {
        logger.warn('Could not retrieve RAV from database for profile, will calculate', {
          profileId,
          error,
        })
        return 0
      }
      return data?.current_remaining_to_live ?? 0
    }
    if (groupId) {
      const { data, error } = await supabaseServer
        .from('bank_balances')
        .select('current_remaining_to_live')
        .eq('group_id', groupId)
        .single()
      if (error) {
        logger.warn('Could not retrieve RAV from database for group, will calculate', {
          groupId,
          error,
        })
        return 0
      }
      return data?.current_remaining_to_live ?? 0
    }
    return 0
  } catch (error) {
    logger.error('Exception while retrieving RAV from database', { profileId, groupId, error })
    return 0
  }
}
