import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import type { Database } from '@/lib/database.types'
import { withAuth } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'

type EstimatedIncomeInsert = Database['public']['Tables']['estimated_incomes']['Insert']
type EstimatedIncomeUpdate = Database['public']['Tables']['estimated_incomes']['Update']

export interface EstimatedIncomeData {
  id: string
  profile_id?: string
  group_id?: string
  name: string
  estimated_amount: number
  is_monthly_recurring: boolean
  created_at: string
  updated_at: string
}

export interface CreateEstimatedIncomeRequest {
  name: string
  estimated_amount: number
  is_monthly_recurring?: boolean
  is_for_group?: boolean
}

/**
 * GET /api/finance/income/estimated - Récupère les revenus estimés
 * Retourne les revenus estimés de l'utilisateur ou de son groupe
 */
export const GET = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const url = new URL(request.url)
    const forGroup = url.searchParams.get('group') === 'true'

    let data, error

    if (forGroup) {
      // Get user's group first
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json({ estimated_incomes: [] })
      }

      // Get group's estimated incomes
      const result = await supabaseServer
        .from('estimated_incomes')
        .select('*')
        .eq('group_id', profile.group_id)
        .order('created_at', { ascending: false })

      data = result.data
      error = result.error
    } else {
      // Get user's personal estimated incomes
      const result = await supabaseServer
        .from('estimated_incomes')
        .select('*')
        .eq('profile_id', userId)
        .order('created_at', { ascending: false })

      data = result.data
      error = result.error
    }

    if (error) {
      logger.error('Error fetching estimated incomes:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des revenus estimés' },
        { status: 500 },
      )
    }

    return NextResponse.json({ estimated_incomes: data || [] })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * POST /api/finance/income/estimated - Crée un nouveau revenu estimé
 */
export const POST = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const body: CreateEstimatedIncomeRequest = await request.json()
    const { name, estimated_amount, is_monthly_recurring = true, is_for_group = false } = body

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Le nom du revenu est requis' }, { status: 400 })
    }

    if (!estimated_amount || typeof estimated_amount !== 'number' || estimated_amount <= 0) {
      return NextResponse.json(
        { error: 'Le montant estimé doit être un nombre positif' },
        { status: 400 },
      )
    }

    const insertData: EstimatedIncomeInsert = {
      name: name.trim(),
      estimated_amount,
      is_monthly_recurring,
    }

    if (is_for_group) {
      // Get user's group
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json(
          { error: 'Vous devez appartenir à un groupe pour ajouter des revenus de groupe' },
          { status: 400 },
        )
      }

      insertData.group_id = profile.group_id
    } else {
      insertData.profile_id = userId
    }

    // Create the estimated income
    const { data, error } = await supabaseServer
      .from('estimated_incomes')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      logger.error('Error creating estimated income:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la création du revenu estimé' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      estimated_income: data,
      message: 'Revenu estimé créé avec succès',
    })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * PUT /api/finance/income/estimated - Met à jour un revenu estimé
 */
export const PUT = withAuth(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { id, name, estimated_amount, is_monthly_recurring } = body

    if (!id) {
      return NextResponse.json({ error: 'ID du revenu estimé requis' }, { status: 400 })
    }

    const updates: EstimatedIncomeUpdate = {}

    if (name !== undefined) {
      if (!name || name.trim().length === 0) {
        return NextResponse.json({ error: 'Le nom ne peut pas être vide' }, { status: 400 })
      }
      updates.name = name.trim()
    }

    if (estimated_amount !== undefined) {
      if (estimated_amount <= 0) {
        return NextResponse.json({ error: 'Le montant estimé doit être positif' }, { status: 400 })
      }
      updates.estimated_amount = estimated_amount
    }

    if (is_monthly_recurring !== undefined) {
      updates.is_monthly_recurring = is_monthly_recurring
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Aucune donnée à mettre à jour' }, { status: 400 })
    }

    // Update the estimated income
    const { data, error } = await supabaseServer
      .from('estimated_incomes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      logger.error('Error updating estimated income:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du revenu estimé' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      estimated_income: data,
      message: 'Revenu estimé mis à jour avec succès',
    })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * DELETE /api/finance/income/estimated - Supprime un revenu estimé
 */
export const DELETE = withAuth(async (request: NextRequest) => {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID du revenu estimé requis' }, { status: 400 })
    }

    // Delete the estimated income
    const { error } = await supabaseServer.from('estimated_incomes').delete().eq('id', id)

    if (error) {
      logger.error('Error deleting estimated income:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression du revenu estimé' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      message: 'Revenu estimé supprimé avec succès',
    })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
