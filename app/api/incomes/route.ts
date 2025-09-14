import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API pour la gestion des revenus estimés
 * - GET: Récupère tous les revenus de l'utilisateur ou du groupe
 * - POST: Crée un nouveau revenu estimé
 */

interface EstimatedIncome {
  id: string
  profile_id?: string
  group_id?: string
  name: string
  estimated_amount: number
  is_monthly_recurring: boolean
  created_at: string
  updated_at: string
}

export async function GET(request: NextRequest) {
  try {
    console.log('🔄 API GET /api/incomes - Début')
    
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId
    console.log('🔐 Session validation - userId:', userId)
    
    if (!userId) {
      console.log('❌ Utilisateur non autorisé')
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const supabase = supabaseServer

    // Récupérer les informations du profil avec le groupe
    console.log('📊 Récupération du profil pour userId:', userId)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (profileError) {
      console.error('❌ Erreur récupération profil:', profileError)
      return NextResponse.json({ error: 'Erreur lors de la récupération du profil' }, { status: 500 })
    }

    if (!profile) {
      console.log('❌ Profil non trouvé pour userId:', userId)
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }
    
    console.log('✅ Profil trouvé:', profile)

    // Récupérer les revenus personnels ET du groupe (si applicable)
    console.log('📋 Construction de la requête pour les revenus')
    
    let orConditions = `profile_id.eq.${userId}`
    if (profile.group_id) {
      console.log('👥 Ajout des revenus de groupe:', profile.group_id)
      orConditions += `,group_id.eq.${profile.group_id}`
    }
    
    console.log('🔍 Condition OR:', orConditions)
    
    const { data: incomes, error } = await supabase
      .from('estimated_incomes')
      .select('*')
      .or(orConditions)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('❌ Erreur lors de la récupération des revenus:', error)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }

    console.log('✅ Revenus récupérés:', incomes?.length || 0, 'éléments')
    console.log('📄 Détail des revenus:', incomes)

    return NextResponse.json({ incomes: incomes || [] })

  } catch (error) {
    console.error('Erreur dans GET /api/incomes:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { name, estimatedAmount, isGroupIncome = false } = await request.json()

    // Validation des données
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Le nom du revenu est requis (minimum 2 caractères)' }, { status: 400 })
    }

    if (!estimatedAmount || typeof estimatedAmount !== 'number' || estimatedAmount <= 0) {
      return NextResponse.json({ error: 'Le montant doit être un nombre positif' }, { status: 400 })
    }

    const supabase = supabaseServer

    // Récupérer les informations du profil
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    // Vérifier si c'est un revenu de groupe et si l'utilisateur fait partie d'un groupe
    if (isGroupIncome && !profile.group_id) {
      return NextResponse.json({ error: 'Vous devez faire partie d\'un groupe pour créer un revenu de groupe' }, { status: 400 })
    }

    // Préparer les données du revenu
    const incomeData = {
      name: name.trim(),
      estimated_amount: estimatedAmount,
      is_monthly_recurring: true, // Par défaut mensuel
      ...(isGroupIncome ? { group_id: profile.group_id } : { profile_id: userId })
    }

    // Créer le revenu
    const { data: income, error } = await supabase
      .from('estimated_incomes')
      .insert(incomeData)
      .select()
      .single()

    if (error) {
      console.error('Erreur lors de la création du revenu:', error)
      return NextResponse.json({ error: 'Erreur lors de la création du revenu' }, { status: 500 })
    }

    return NextResponse.json({ income }, { status: 201 })

  } catch (error) {
    console.error('Erreur dans POST /api/incomes:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const incomeId = searchParams.get('id')

    if (!incomeId) {
      return NextResponse.json({ error: 'ID du revenu requis' }, { status: 400 })
    }

    const supabase = supabaseServer

    // Récupérer les informations du profil
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    // Supprimer le revenu (seulement si c'est le sien ou de son groupe)
    let query = supabase
      .from('estimated_incomes')
      .delete()
      .eq('id', incomeId)
      .or(`profile_id.eq.${userId}`)

    if (profile.group_id) {
      query = query.or(`group_id.eq.${profile.group_id}`)
    }

    const { error } = await query

    if (error) {
      console.error('Erreur lors de la suppression du revenu:', error)
      return NextResponse.json({ error: 'Erreur lors de la suppression' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Revenu supprimé avec succès' })

  } catch (error) {
    console.error('Erreur dans DELETE /api/incomes:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}