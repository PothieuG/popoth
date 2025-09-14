import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

export interface RealExpenseData {
  id: string
  profile_id?: string
  group_id?: string
  estimated_budget_id?: string
  amount: number
  description: string
  expense_date: string
  is_exceptional: boolean
  created_at: string
  estimated_budget?: {
    name: string
  }
}

export interface CreateRealExpenseRequest {
  amount: number
  description: string
  expense_date?: string
  estimated_budget_id?: string
  is_for_group?: boolean
}

/**
 * GET /api/finances/expenses/real - Récupère les dépenses réelles
 * Retourne les dépenses de l'utilisateur ou de son groupe
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const forGroup = url.searchParams.get('group') === 'true'
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const budgetId = url.searchParams.get('budget_id')
    const isExceptional = url.searchParams.get('exceptional')

    let query = supabaseServer
      .from('real_expenses')
      .select(`
        *,
        estimated_budget:estimated_budgets(name)
      `)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (forGroup) {
      // Get user's group first
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', session.userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json({ real_expenses: [], total: 0 })
      }

      query = query.eq('group_id', profile.group_id)
    } else {
      query = query.eq('profile_id', session.userId)
    }

    // Additional filters
    if (budgetId) {
      query = query.eq('estimated_budget_id', budgetId)
    }

    if (isExceptional === 'true') {
      query = query.eq('is_exceptional', true)
    } else if (isExceptional === 'false') {
      query = query.eq('is_exceptional', false)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching real expenses:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des dépenses' },
        { status: 500 }
      )
    }

    // Get total count for pagination
    let countQuery = supabaseServer
      .from('real_expenses')
      .select('*', { count: 'exact', head: true })

    if (forGroup) {
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', session.userId)
        .single()

      if (profile?.group_id) {
        countQuery = countQuery.eq('group_id', profile.group_id)
      }
    } else {
      countQuery = countQuery.eq('profile_id', session.userId)
    }

    if (budgetId) {
      countQuery = countQuery.eq('estimated_budget_id', budgetId)
    }

    if (isExceptional === 'true') {
      countQuery = countQuery.eq('is_exceptional', true)
    } else if (isExceptional === 'false') {
      countQuery = countQuery.eq('is_exceptional', false)
    }

    const { count } = await countQuery

    return NextResponse.json({ 
      real_expenses: data || [], 
      total: count || 0,
      limit,
      offset
    })
  } catch (error) {
    console.error('Error in GET /api/finances/expenses/real:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/finances/expenses/real - Crée une nouvelle dépense réelle
 */
export async function POST(request: NextRequest) {
  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const body: CreateRealExpenseRequest = await request.json()
    const { 
      amount, 
      description, 
      expense_date, 
      estimated_budget_id,
      is_for_group = false 
    } = body

    // Validation
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { error: 'Le montant doit être un nombre positif' },
        { status: 400 }
      )
    }

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json(
        { error: 'La description est requise' },
        { status: 400 }
      )
    }

    let insertData: any = {
      amount,
      description: description.trim(),
      expense_date: expense_date || new Date().toISOString().split('T')[0],
      is_exceptional: !estimated_budget_id
    }

    if (estimated_budget_id) {
      // Verify that the estimated budget exists and belongs to the user/group
      const { data: estimatedBudget, error: verifyError } = await supabaseServer
        .from('estimated_budgets')
        .select('id, profile_id, group_id')
        .eq('id', estimated_budget_id)
        .single()

      if (verifyError || !estimatedBudget) {
        return NextResponse.json(
          { error: 'Budget estimé introuvable' },
          { status: 404 }
        )
      }

      // Check ownership
      if (is_for_group) {
        const { data: profile } = await supabaseServer
          .from('profiles')
          .select('group_id')
          .eq('id', session.userId)
          .single()

        if (!profile?.group_id || estimatedBudget.group_id !== profile.group_id) {
          return NextResponse.json(
            { error: 'Budget estimé non autorisé pour ce groupe' },
            { status: 403 }
          )
        }
      } else {
        if (estimatedBudget.profile_id !== session.userId) {
          return NextResponse.json(
            { error: 'Budget estimé non autorisé pour cet utilisateur' },
            { status: 403 }
          )
        }
      }

      insertData.estimated_budget_id = estimated_budget_id
    }

    if (is_for_group) {
      // Get user's group
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', session.userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json(
          { error: 'Vous devez appartenir à un groupe pour ajouter des dépenses de groupe' },
          { status: 400 }
        )
      }

      insertData.group_id = profile.group_id
    } else {
      insertData.profile_id = session.userId
    }

    // Create the real expense
    const { data, error } = await supabaseServer
      .from('real_expenses')
      .insert(insertData)
      .select(`
        *,
        estimated_budget:estimated_budgets(name)
      `)
      .single()

    if (error) {
      console.error('Error creating real expense:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la création de la dépense' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      real_expense: data,
      message: 'Dépense créée avec succès'
    })
  } catch (error) {
    console.error('Error in POST /api/finances/expenses/real:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/finances/expenses/real - Met à jour une dépense réelle
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { id, amount, description, expense_date, estimated_budget_id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'ID de la dépense requis' },
        { status: 400 }
      )
    }

    const updates: any = {}
    
    if (amount !== undefined) {
      if (amount <= 0) {
        return NextResponse.json(
          { error: 'Le montant doit être positif' },
          { status: 400 }
        )
      }
      updates.amount = amount
    }

    if (description !== undefined) {
      if (!description || description.trim().length === 0) {
        return NextResponse.json(
          { error: 'La description ne peut pas être vide' },
          { status: 400 }
        )
      }
      updates.description = description.trim()
    }

    if (expense_date !== undefined) {
      updates.expense_date = expense_date
    }

    if (estimated_budget_id !== undefined) {
      updates.estimated_budget_id = estimated_budget_id
      updates.is_exceptional = !estimated_budget_id
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'Aucune donnée à mettre à jour' },
        { status: 400 }
      )
    }

    // Update the real expense
    const { data, error } = await supabaseServer
      .from('real_expenses')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        estimated_budget:estimated_budgets(name)
      `)
      .single()

    if (error) {
      console.error('Error updating real expense:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour de la dépense' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      real_expense: data,
      message: 'Dépense mise à jour avec succès'
    })
  } catch (error) {
    console.error('Error in PUT /api/finances/expenses/real:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/finances/expenses/real - Supprime une dépense réelle
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'ID de la dépense requis' },
        { status: 400 }
      )
    }

    // Delete the real expense
    const { error } = await supabaseServer
      .from('real_expenses')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting real expense:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression de la dépense' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Dépense supprimée avec succès'
    })
  } catch (error) {
    console.error('Error in DELETE /api/finances/expenses/real:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}