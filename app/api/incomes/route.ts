import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import { saveRemainingToLiveSnapshot } from '@/lib/financial-calculations'

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
      .select('id, profile_id, group_id, name, estimated_amount, is_monthly_recurring, created_at, updated_at')
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

    // Sauvegarder automatiquement le nouveau reste à vivre
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: isGroupIncome ? undefined : userId,
      groupId: isGroupIncome ? profile.group_id : undefined,
      reason: 'income_created'
    })

    if (snapshotSuccess) {
      console.log('📊 Snapshot reste à vivre sauvegardé après création revenu')
    } else {
      console.log('⚠️ Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ income }, { status: 201 })

  } catch (error) {
    console.error('Erreur dans POST /api/incomes:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    console.log('🔄 API PUT /api/incomes - Début')

    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId
    console.log('🔐 Session validation:', userId ? '✅ Valid' : '❌ Invalid')

    if (!userId) {
      console.log('❌ Utilisateur non autorisé')
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const incomeId = searchParams.get('id')

    if (!incomeId) {
      return NextResponse.json({ error: 'ID du revenu requis' }, { status: 400 })
    }

    const body = await request.json()
    console.log('📥 Données reçues:', body)

    const { name, estimatedAmount } = body

    // Validation des données
    console.log('🔍 Validation - name:', name, 'type:', typeof name)
    console.log('🔍 Validation - estimatedAmount:', estimatedAmount, 'type:', typeof estimatedAmount)

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      console.log('❌ Validation échouée: nom invalide')
      return NextResponse.json({ error: 'Le nom du revenu est requis (minimum 2 caractères)' }, { status: 400 })
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

    if (profileError || !profile) {
      console.error('❌ Erreur récupération profil:', profileError)
      return NextResponse.json({ error: 'Erreur lors de la récupération du profil' }, { status: 500 })
    }

    console.log('✅ Profil trouvé:', profile)

    // Préparer les données de mise à jour
    const updateData = {
      name: name.trim(),
      estimated_amount: estimatedAmount,
      updated_at: new Date().toISOString()
    }

    console.log('💾 Données revenu à mettre à jour:', updateData)

    // Vérifier d'abord que le revenu appartient à l'utilisateur ou à son groupe
    let ownershipCondition = `profile_id.eq.${userId}`
    if (profile.group_id) {
      ownershipCondition += `,group_id.eq.${profile.group_id}`
    }

    // Vérifier l'existence et les permissions
    const { data: existingIncome } = await supabase
      .from('estimated_incomes')
      .select('id, profile_id, group_id, name, estimated_amount, is_monthly_recurring, created_at, updated_at')
      .eq('id', incomeId)
      .or(ownershipCondition)
      .single()

    if (!existingIncome) {
      console.log('❌ Revenu non trouvé ou accès non autorisé')
      return NextResponse.json({ error: 'Revenu non trouvé ou accès non autorisé' }, { status: 404 })
    }

    // Mettre à jour le revenu
    const { data: income, error } = await supabase
      .from('estimated_incomes')
      .update(updateData)
      .eq('id', incomeId)
      .select()
      .single()

    if (error) {
      console.error('❌ Erreur lors de la mise à jour du revenu:', error)
      return NextResponse.json({ error: 'Erreur lors de la mise à jour du revenu' }, { status: 500 })
    }

    console.log('✅ Revenu mis à jour avec succès:', income)

    // Sauvegarder automatiquement le nouveau reste à vivre après modification
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: existingIncome.profile_id || undefined,
      groupId: existingIncome.group_id || undefined,
      reason: 'income_updated'
    })

    if (snapshotSuccess) {
      console.log('📊 Snapshot reste à vivre sauvegardé après mise à jour revenu')
    } else {
      console.log('⚠️ Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ income })

  } catch (error) {
    console.error('Erreur dans PUT /api/incomes:', error)
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

    // Vérifier d'abord que le revenu appartient à l'utilisateur ou à son groupe
    let ownershipCondition = `profile_id.eq.${userId}`
    if (profile.group_id) {
      ownershipCondition += `,group_id.eq.${profile.group_id}`
    }

    // Vérifier l'existence et les permissions
    const { data: existingIncome } = await supabase
      .from('estimated_incomes')
      .select('*')
      .eq('id', incomeId)
      .or(ownershipCondition)
      .single()

    if (!existingIncome) {
      console.log('❌ Revenu non trouvé ou accès non autorisé pour suppression')
      return NextResponse.json({ error: 'Revenu non trouvé ou accès non autorisé' }, { status: 404 })
    }

    // Supprimer le revenu
    const { error } = await supabase
      .from('estimated_incomes')
      .delete()
      .eq('id', incomeId)

    if (error) {
      console.error('Erreur lors de la suppression du revenu:', error)
      return NextResponse.json({ error: 'Erreur lors de la suppression' }, { status: 500 })
    }

    // Sauvegarder automatiquement le nouveau reste à vivre après suppression
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: existingIncome.profile_id || undefined,
      groupId: existingIncome.group_id || undefined,
      reason: 'income_deleted'
    })

    if (snapshotSuccess) {
      console.log('📊 Snapshot reste à vivre sauvegardé après suppression revenu')
    } else {
      console.log('⚠️ Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ message: 'Revenu supprimé avec succès' })

  } catch (error) {
    console.error('Erreur dans DELETE /api/incomes:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}