import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { saveRemainingToLiveSnapshot } from '@/lib/financial-calculations'
import { withAuthAndProfile } from '@/lib/api/with-auth'

/**
 * API pour la gestion des revenus estimés
 * - GET: Récupère tous les revenus de l'utilisateur ou du groupe
 * - POST: Crée un nouveau revenu estimé
 */

export const GET = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    console.log('🔄 API GET /api/finance/incomes - Début')

    // Récupérer le paramètre de contexte depuis l'URL
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' | null

    const supabase = supabaseServer

    console.log('✅ Profil trouvé:', profile)

    // Construire la requête selon le contexte demandé
    console.log('📋 Construction de la requête pour les revenus, contexte:', context)

    let query
    if (context === 'group' && profile.group_id) {
      // Récupérer seulement les revenus du groupe
      console.log('👥 Récupération des revenus de groupe uniquement:', profile.group_id)
      query = supabase
        .from('estimated_incomes')
        .select('*')
        .eq('group_id', profile.group_id)
        .is('profile_id', null)
    } else {
      // Récupérer seulement les revenus personnels
      console.log('👤 Récupération des revenus personnels uniquement:', userId)
      query = supabase
        .from('estimated_incomes')
        .select('*')
        .eq('profile_id', userId)
        .is('group_id', null)
    }

    const { data: incomes, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('❌ Erreur lors de la récupération des revenus:', error)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }

    console.log('✅ Revenus récupérés:', incomes?.length || 0, 'éléments')
    console.log('📄 Détail des revenus:', incomes)

    return NextResponse.json({ incomes: incomes || [] })
  } catch (error) {
    console.error('Erreur dans GET /api/finance/incomes:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

export const POST = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    // Récupérer le paramètre de contexte depuis l'URL
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' | null

    const { name, estimatedAmount } = await request.json()
    console.log('🎯 Contexte income:', context)

    // Validation des données
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json(
        { error: 'Le nom du revenu est requis (minimum 2 caractères)' },
        { status: 400 },
      )
    }

    if (!estimatedAmount || typeof estimatedAmount !== 'number' || estimatedAmount <= 0) {
      return NextResponse.json({ error: 'Le montant doit être un nombre positif' }, { status: 400 })
    }

    const supabase = supabaseServer

    // Vérifier le contexte et l'appartenance à un groupe
    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Vous devez faire partie d'un groupe pour créer un revenu de groupe" },
        { status: 400 },
      )
    }

    // Préparer les données du revenu selon le contexte
    let incomeData
    if (context === 'group') {
      incomeData = {
        name: name.trim(),
        estimated_amount: estimatedAmount,
        is_monthly_recurring: true,
        group_id: profile.group_id,
        profile_id: null,
      }
    } else {
      incomeData = {
        name: name.trim(),
        estimated_amount: estimatedAmount,
        is_monthly_recurring: true,
        profile_id: userId,
        group_id: null,
      }
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
      profileId: context === 'group' ? undefined : userId,
      groupId: context === 'group' ? (profile.group_id ?? undefined) : undefined,
      reason: 'income_created',
    })

    if (snapshotSuccess) {
      console.log('📊 Snapshot reste à vivre sauvegardé après création revenu')
    } else {
      console.log('⚠️ Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ income }, { status: 201 })
  } catch (error) {
    console.error('Erreur dans POST /api/finance/incomes:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

export const PUT = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    console.log('🔄 API PUT /api/finance/incomes - Début')

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
    console.log(
      '🔍 Validation - estimatedAmount:',
      estimatedAmount,
      'type:',
      typeof estimatedAmount,
    )

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      console.log('❌ Validation échouée: nom invalide')
      return NextResponse.json(
        { error: 'Le nom du revenu est requis (minimum 2 caractères)' },
        { status: 400 },
      )
    }

    if (!estimatedAmount || typeof estimatedAmount !== 'number' || estimatedAmount <= 0) {
      console.log('❌ Validation échouée: montant invalide')
      return NextResponse.json({ error: 'Le montant doit être un nombre positif' }, { status: 400 })
    }

    const supabase = supabaseServer

    console.log('✅ Profil trouvé:', profile)

    // Préparer les données de mise à jour
    const updateData = {
      name: name.trim(),
      estimated_amount: estimatedAmount,
      updated_at: new Date().toISOString(),
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
      .select(
        'id, profile_id, group_id, name, estimated_amount, is_monthly_recurring, created_at, updated_at',
      )
      .eq('id', incomeId)
      .or(ownershipCondition)
      .single()

    if (!existingIncome) {
      console.log('❌ Revenu non trouvé ou accès non autorisé')
      return NextResponse.json(
        { error: 'Revenu non trouvé ou accès non autorisé' },
        { status: 404 },
      )
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
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du revenu' },
        { status: 500 },
      )
    }

    console.log('✅ Revenu mis à jour avec succès:', income)

    // Sauvegarder automatiquement le nouveau reste à vivre après modification
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: existingIncome.profile_id || undefined,
      groupId: existingIncome.group_id || undefined,
      reason: 'income_updated',
    })

    if (snapshotSuccess) {
      console.log('📊 Snapshot reste à vivre sauvegardé après mise à jour revenu')
    } else {
      console.log('⚠️ Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ income })
  } catch (error) {
    console.error('Erreur dans PUT /api/finance/incomes:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

export const DELETE = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { searchParams } = new URL(request.url)
    const incomeId = searchParams.get('id')

    if (!incomeId) {
      return NextResponse.json({ error: 'ID du revenu requis' }, { status: 400 })
    }

    const supabase = supabaseServer

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
      return NextResponse.json(
        { error: 'Revenu non trouvé ou accès non autorisé' },
        { status: 404 },
      )
    }

    // Supprimer le revenu
    const { error } = await supabase.from('estimated_incomes').delete().eq('id', incomeId)

    if (error) {
      console.error('Erreur lors de la suppression du revenu:', error)
      return NextResponse.json({ error: 'Erreur lors de la suppression' }, { status: 500 })
    }

    // Sauvegarder automatiquement le nouveau reste à vivre après suppression
    const snapshotSuccess = await saveRemainingToLiveSnapshot({
      profileId: existingIncome.profile_id || undefined,
      groupId: existingIncome.group_id || undefined,
      reason: 'income_deleted',
    })

    if (snapshotSuccess) {
      console.log('📊 Snapshot reste à vivre sauvegardé après suppression revenu')
    } else {
      console.log('⚠️ Échec sauvegarde snapshot (non critique)')
    }

    return NextResponse.json({ message: 'Revenu supprimé avec succès' })
  } catch (error) {
    console.error('Erreur dans DELETE /api/finance/incomes:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})
