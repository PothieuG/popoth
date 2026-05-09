import { supabaseServer } from '@/lib/supabase-server'

export type RecapContext = 'profile' | 'group'

export interface RecapStatus {
  required: boolean
  currentMonth: number
  currentYear: number
  hasExistingRecap: boolean
  context: RecapContext
  contextId: string
}

export class RecapStatusError extends Error {
  constructor(
    public code: 'PROFILE_NOT_FOUND' | 'NO_GROUP',
    message: string,
  ) {
    super(message)
    this.name = 'RecapStatusError'
  }
}

export async function checkRecapStatus(
  userId: string,
  context: RecapContext,
): Promise<RecapStatus> {
  const currentDate = new Date()
  const currentMonth = currentDate.getMonth() + 1
  const currentYear = currentDate.getFullYear()

  const { data: profile, error: profileError } = await supabaseServer
    .from('profiles')
    .select('id, group_id')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    throw new RecapStatusError('PROFILE_NOT_FOUND', 'Profil utilisateur non trouvé')
  }

  let hasExistingRecap = false
  let contextId = ''

  if (context === 'profile') {
    contextId = profile.id

    const { data: existingRecap } = await supabaseServer
      .from('monthly_recaps')
      .select('id')
      .eq('profile_id', profile.id)
      .eq('recap_month', currentMonth)
      .eq('recap_year', currentYear)
      .single()

    hasExistingRecap = !!existingRecap
  } else {
    if (!profile.group_id) {
      throw new RecapStatusError('NO_GROUP', "Utilisateur ne fait partie d'aucun groupe")
    }

    contextId = profile.group_id

    const { data: existingRecap } = await supabaseServer
      .from('monthly_recaps')
      .select('id')
      .eq('group_id', profile.group_id)
      .eq('recap_month', currentMonth)
      .eq('recap_year', currentYear)
      .single()

    hasExistingRecap = !!existingRecap
  }

  return {
    required: !hasExistingRecap,
    currentMonth,
    currentYear,
    hasExistingRecap,
    context,
    contextId,
  }
}
