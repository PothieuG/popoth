import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuth } from '@/lib/api/with-auth'
import { parseBody, parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { updateBankBalanceBodySchema } from '@/lib/schemas/bank-balance'
import { contextOnlyQuerySchema } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

/**
 * GET - Récupère le solde bancaire de l'utilisateur ou du groupe
 */
export const GET = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const { context } = parseQuery(request, contextOnlyQuerySchema)

    let query
    if (context === 'group') {
      // Récupérer d'abord le groupe de l'utilisateur
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json(
          { error: "Utilisateur ne fait pas partie d'un groupe" },
          { status: 400 },
        )
      }

      // Récupérer le solde du groupe
      query = supabaseServer
        .from('bank_balances')
        .select('balance')
        .eq('group_id', profile.group_id)
        .single()
    } else {
      // Récupérer le solde personnel
      query = supabaseServer
        .from('bank_balances')
        .select('balance')
        .eq('profile_id', userId)
        .single()
    }

    const { data, error } = await query

    if (error) {
      logger.warn('Erreur Supabase dans bank-balance:', error)

      // Si la table n'existe pas, retourner 0 sans erreur
      if (
        error.code === '42P01' ||
        error.message?.includes('relation "bank_balances" does not exist')
      ) {
        return NextResponse.json({ balance: 0 })
      }

      // Si aucun enregistrement trouvé (PGRST116), retourner 0
      if (error.code === 'PGRST116') {
        return NextResponse.json({ balance: 0 })
      }

      return NextResponse.json(
        { error: `Erreur base de données: ${error.message}` },
        { status: 500 },
      )
    }

    // Si un solde existe, le retourner
    const balance = data?.balance ?? 0

    return NextResponse.json({ balance })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json(
      { error: `Erreur interne: ${error instanceof Error ? error.message : 'Erreur inconnue'}` },
      { status: 500 },
    )
  }
})

/**
 * POST - Met à jour le solde bancaire de l'utilisateur ou du groupe
 */
export const POST = withAuth(async (request: NextRequest, { userId }) => {
  try {
    // Récupérer le paramètre de contexte depuis l'URL
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' | null

    const { balance } = await parseBody(request, updateBankBalanceBodySchema)

    // Construire la requête selon le contexte
    let checkQuery, checkCondition, insertData
    const updateData = { balance, updated_at: new Date().toISOString() }

    if (context === 'group') {
      // Récupérer le groupe de l'utilisateur
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json(
          { error: "Utilisateur ne fait pas partie d'un groupe" },
          { status: 400 },
        )
      }
      const groupId = profile.group_id
      checkQuery = supabaseServer
        .from('bank_balances')
        .select('id')
        .eq('group_id', groupId)
        .single()

      checkCondition = { group_id: groupId }
      insertData = { group_id: groupId, profile_id: null, balance }
    } else {
      checkQuery = supabaseServer
        .from('bank_balances')
        .select('id')
        .eq('profile_id', userId)
        .single()

      checkCondition = { profile_id: userId }
      insertData = { profile_id: userId, group_id: null, balance }
    }

    // Vérifier si un solde existe déjà
    const { data: existingBalance, error: checkError } = await checkQuery

    if (checkError && checkError.code !== 'PGRST116' && checkError.code !== '42P01') {
      logger.error('Erreur lors de la vérification du solde existant:', checkError)
      return NextResponse.json(
        { error: `Erreur vérification: ${checkError.message}` },
        { status: 500 },
      )
    }

    // Si la table n'existe pas, retourner une erreur explicite
    if (
      checkError?.code === '42P01' ||
      checkError?.message?.includes('relation "bank_balances" does not exist')
    ) {
      return NextResponse.json(
        { error: 'Table bank_balances non créée. Veuillez créer la table dans Supabase.' },
        { status: 500 },
      )
    }

    let result
    if (existingBalance) {
      // Mettre à jour le solde existant
      const { data, error } = await supabaseServer
        .from('bank_balances')
        .update(updateData)
        .match(checkCondition)
        .select('balance')
        .single()

      result = { data, error }
    } else {
      // Créer un nouveau solde
      const { data, error } = await supabaseServer
        .from('bank_balances')
        .insert(insertData)
        .select('balance')
        .single()

      result = { data, error }
    }

    if (result.error) {
      logger.error('Erreur lors de la mise à jour du solde bancaire:', result.error)
      return NextResponse.json(
        { error: `Erreur mise à jour: ${result.error.message}` },
        { status: 500 },
      )
    }

    return NextResponse.json({
      balance: result.data?.balance,
      message: 'Solde bancaire mis à jour avec succès',
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json(
      { error: `Erreur interne: ${error instanceof Error ? error.message : 'Erreur inconnue'}` },
      { status: 500 },
    )
  }
})
