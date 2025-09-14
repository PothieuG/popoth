import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API pour la gestion des budgets estimés
 * - GET: Récupère tous les budgets de l'utilisateur ou du groupe
 * - POST: Crée un nouveau budget estimé
 */

interface EstimatedBudget {
  id: string
  profile_id?: string
  group_id?: string
  name: string
  estimated_amount: number
  current_savings: number
  is_monthly_recurring: boolean
  created_at: string
  updated_at: string
}

export async function GET(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const supabase = supabaseServer

    // Récupérer les informations du profil avec le groupe
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    // Récupérer les budgets personnels ET du groupe (si applicable)
    console.log('📋 Construction de la requête pour les budgets')
    
    let orConditions = `profile_id.eq.${userId}`
    if (profile.group_id) {
      console.log('👥 Ajout des budgets de groupe:', profile.group_id)
      orConditions += `,group_id.eq.${profile.group_id}`
    }
    
    console.log('🔍 Condition OR:', orConditions)
    
    const { data: budgets, error } = await supabase
      .from('estimated_budgets')
      .select('*')
      .or(orConditions)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('❌ Erreur lors de la récupération des budgets:', error)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }

    console.log('✅ Budgets récupérés:', budgets?.length || 0, 'éléments')
    console.log('📄 Détail des budgets:', budgets)

    return NextResponse.json({ budgets: budgets || [] })

  } catch (error) {
    console.error('Erreur dans GET /api/budgets:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 API POST /api/budgets - Début')
    
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId
    console.log('🔐 Session validation:', userId ? '✅ Valid' : '❌ Invalid')
    
    if (!userId) {
      console.log('❌ Utilisateur non autorisé')
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await request.json()
    console.log('📥 Données reçues:', body)
    
    const { name, estimatedAmount, isGroupBudget = false } = body

    // Validation des données
    console.log('🔍 Validation - name:', name, 'type:', typeof name)
    console.log('🔍 Validation - estimatedAmount:', estimatedAmount, 'type:', typeof estimatedAmount)
    
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      console.log('❌ Validation échouée: nom invalide')
      return NextResponse.json({ error: 'Le nom du budget est requis (minimum 2 caractères)' }, { status: 400 })
    }

    if (!estimatedAmount || typeof estimatedAmount !== 'number' || estimatedAmount <= 0) {
      console.log('❌ Validation échouée: montant invalide')
      return NextResponse.json({ error: 'Le montant doit être un nombre positif' }, { status: 400 })
    }

    const supabase = supabaseServer

    // Récupérer les informations du profil
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

    // Vérifier si c'est un budget de groupe et si l'utilisateur fait partie d'un groupe
    if (isGroupBudget && !profile.group_id) {
      return NextResponse.json({ error: 'Vous devez faire partie d\'un groupe pour créer un budget de groupe' }, { status: 400 })
    }

    // Préparer les données du budget
    const budgetData = {
      name: name.trim(),
      estimated_amount: estimatedAmount,
      current_savings: 0, // Sera calculé automatiquement par les triggers
      is_monthly_recurring: true, // Par défaut mensuel
      ...(isGroupBudget ? { group_id: profile.group_id } : { profile_id: userId })
    }
    
    console.log('💾 Données budget à insérer:', budgetData)

    // Créer le budget
    const { data: budget, error } = await supabase
      .from('estimated_budgets')
      .insert(budgetData)
      .select()
      .single()

    if (error) {
      console.error('❌ Erreur lors de la création du budget:', error)
      return NextResponse.json({ error: 'Erreur lors de la création du budget' }, { status: 500 })
    }

    console.log('✅ Budget créé avec succès:', budget)
    return NextResponse.json({ budget }, { status: 201 })

  } catch (error) {
    console.error('Erreur dans POST /api/budgets:', error)
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
    const budgetId = searchParams.get('id')

    if (!budgetId) {
      return NextResponse.json({ error: 'ID du budget requis' }, { status: 400 })
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

    // Supprimer le budget (seulement si c'est le sien ou de son groupe)
    let query = supabase
      .from('estimated_budgets')
      .delete()
      .eq('id', budgetId)
      .or(`profile_id.eq.${userId}`)

    if (profile.group_id) {
      query = query.or(`group_id.eq.${profile.group_id}`)
    }

    const { error } = await query

    if (error) {
      console.error('Erreur lors de la suppression du budget:', error)
      return NextResponse.json({ error: 'Erreur lors de la suppression' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Budget supprimé avec succès' })

  } catch (error) {
    console.error('Erreur dans DELETE /api/budgets:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}