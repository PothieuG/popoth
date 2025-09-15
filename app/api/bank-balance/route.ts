import { NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * GET - Récupère le solde bancaire de l'utilisateur
 */
export async function GET(request: Request) {
  try {
    const sessionData = await validateSessionToken(request)
    if (!sessionData) {
      console.error('Token non valide dans bank-balance API')
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    console.log('Récupération du solde bancaire pour l\'utilisateur:', sessionData.userId)

    const { data, error } = await supabaseServer
      .from('bank_balances')
      .select('balance')
      .eq('profile_id', sessionData.userId)
      .single()

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
 * POST - Met à jour le solde bancaire de l'utilisateur
 */
export async function POST(request: Request) {
  try {
    const sessionData = await validateSessionToken(request)
    if (!sessionData) {
      console.error('Token non valide dans POST bank-balance')
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { balance } = await request.json()
    console.log('Mise à jour du solde bancaire:', balance, 'pour utilisateur:', sessionData.userId)

    if (typeof balance !== 'number' || isNaN(balance)) {
      console.error('Solde invalide:', balance)
      return NextResponse.json(
        { error: 'Le solde doit être un nombre valide' },
        { status: 400 }
      )
    }

    // Vérifier si un solde existe déjà pour cet utilisateur
    const { data: existingBalance, error: checkError } = await supabaseServer
      .from('bank_balances')
      .select('id')
      .eq('profile_id', sessionData.userId)
      .single()

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
      console.log('Mise à jour du solde existant')
      // Mettre à jour le solde existant
      const { data, error } = await supabaseServer
        .from('bank_balances')
        .update({
          balance,
          updated_at: new Date().toISOString()
        })
        .eq('profile_id', sessionData.userId)
        .select('balance')
        .single()

      result = { data, error }
    } else {
      console.log('Création d\'un nouveau solde')
      // Créer un nouveau solde
      const { data, error } = await supabaseServer
        .from('bank_balances')
        .insert({
          profile_id: sessionData.userId,
          balance
        })
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

    console.log('Solde bancaire mis à jour avec succès:', result.data.balance)
    return NextResponse.json({
      balance: result.data.balance,
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