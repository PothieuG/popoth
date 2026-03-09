import { NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * GET - Récupère le solde bancaire de l'utilisateur ou du groupe
 */
export async function GET(request: Request) {
  try {
    const sessionData = await validateSessionToken(request)
    if (!sessionData) {
      console.error('Token non valide dans bank-balance API')
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Récupérer le paramètre de contexte depuis l'URL
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' | null

    console.log('Récupération du solde bancaire, contexte:', context, 'userId:', sessionData.userId)

    let query
    if (context === 'group') {
      // Récupérer d'abord le groupe de l'utilisateur
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', sessionData.userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json({ error: 'Utilisateur ne fait pas partie d\'un groupe' }, { status: 400 })
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
        .eq('profile_id', sessionData.userId)
        .single()
    }

    const { data, error } = await query

    if (error) {
      console.error('Erreur Supabase dans bank-balance:', error)

      // Si la table n'existe pas, retourner 0 sans erreur
      if (error.code === '42P01' || error.message?.includes('relation "bank_balances" does not exist')) {
        console.log('Table bank_balances n\'existe pas encore, retour de 0')
        return NextResponse.json({ balance: 0 })
      }

      // Si aucun enregistrement trouvé (PGRST116), retourner 0
      if (error.code === 'PGRST116') {
        console.log('Aucun solde trouvé pour l\'utilisateur, retour de 0')
        return NextResponse.json({ balance: 0 })
      }

      return NextResponse.json(
        { error: `Erreur base de données: ${error.message}` },
        { status: 500 }
      )
    }

    // Si un solde existe, le retourner
    const balance = data?.balance ?? 0
    console.log('Solde bancaire récupéré:', balance)

    return NextResponse.json({ balance })
  } catch (error) {
    console.error('Erreur dans GET /api/bank-balance:', error)
    return NextResponse.json(
      { error: `Erreur interne: ${error instanceof Error ? error.message : 'Erreur inconnue'}` },
      { status: 500 }
    )
  }
}

/**
 * POST - Met à jour le solde bancaire de l'utilisateur ou du groupe
 */
export async function POST(request: Request) {
  try {
    const sessionData = await validateSessionToken(request)
    if (!sessionData) {
      console.error('Token non valide dans POST bank-balance')
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Récupérer le paramètre de contexte depuis l'URL
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' | null

    const { balance } = await request.json()
    console.log('Mise à jour du solde bancaire:', balance, 'contexte:', context, 'userId:', sessionData.userId)

    if (typeof balance !== 'number' || isNaN(balance)) {
      console.error('Solde invalide:', balance)
      return NextResponse.json(
        { error: 'Le solde doit être un nombre valide' },
        { status: 400 }
      )
    }

    let groupId = null
    if (context === 'group') {
      // Récupérer le groupe de l'utilisateur
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', sessionData.userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json({ error: 'Utilisateur ne fait pas partie d\'un groupe' }, { status: 400 })
      }
      groupId = profile.group_id
    }

    // Construire la requête selon le contexte
    let checkQuery, updateData, checkCondition, insertData

    if (context === 'group') {
      checkQuery = supabaseServer
        .from('bank_balances')
        .select('id')
        .eq('group_id', groupId)
        .single()

      checkCondition = { group_id: groupId }
      updateData = { balance, updated_at: new Date().toISOString() }
      insertData = { group_id: groupId, profile_id: null, balance }
    } else {
      checkQuery = supabaseServer
        .from('bank_balances')
        .select('id')
        .eq('profile_id', sessionData.userId)
        .single()

      checkCondition = { profile_id: sessionData.userId }
      updateData = { balance, updated_at: new Date().toISOString() }
      insertData = { profile_id: sessionData.userId, group_id: null, balance }
    }

    // Vérifier si un solde existe déjà
    const { data: existingBalance, error: checkError } = await checkQuery

    if (checkError && checkError.code !== 'PGRST116' && checkError.code !== '42P01') {
      console.error('Erreur lors de la vérification du solde existant:', checkError)
      return NextResponse.json(
        { error: `Erreur vérification: ${checkError.message}` },
        { status: 500 }
      )
    }

    // Si la table n'existe pas, retourner une erreur explicite
    if (checkError?.code === '42P01' || checkError?.message?.includes('relation "bank_balances" does not exist')) {
      console.error('Table bank_balances n\'existe pas')
      return NextResponse.json(
        { error: 'Table bank_balances non créée. Veuillez créer la table dans Supabase.' },
        { status: 500 }
      )
    }

    let result
    if (existingBalance) {
      console.log('Mise à jour du solde existant pour contexte:', context)
      // Mettre à jour le solde existant
      const { data, error } = await supabaseServer
        .from('bank_balances')
        .update(updateData)
        .match(checkCondition)
        .select('balance')
        .single()

      result = { data, error }
    } else {
      console.log('Création d\'un nouveau solde pour contexte:', context)
      // Créer un nouveau solde
      const { data, error } = await supabaseServer
        .from('bank_balances')
        .insert(insertData)
        .select('balance')
        .single()

      result = { data, error }
    }

    if (result.error) {
      console.error('Erreur lors de la mise à jour du solde bancaire:', result.error)
      return NextResponse.json(
        { error: `Erreur mise à jour: ${result.error.message}` },
        { status: 500 }
      )
    }

    console.log('Solde bancaire mis à jour avec succès:', result.data?.balance)
    return NextResponse.json({
      balance: result.data?.balance,
      message: 'Solde bancaire mis à jour avec succès'
    })
  } catch (error) {
    console.error('Erreur dans POST /api/bank-balance:', error)
    return NextResponse.json(
      { error: `Erreur interne: ${error instanceof Error ? error.message : 'Erreur inconnue'}` },
      { status: 500 }
    )
  }
}