import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

export interface EstimatedBudgetData {
  id: string
  profile_id?: string
  group_id?: string
  name: string
  estimated_amount: number
  is_monthly_recurring: boolean
  created_at: string
  updated_at: string
  spent_this_month?: number
}

export interface CreateEstimatedBudgetRequest {
  name: string
  estimated_amount: number
  is_monthly_recurring?: boolean
  is_for_group?: boolean
}

/**
 * GET /api/finances/budgets/estimated - Récupère les budgets estimés
 * Retourne les budgets estimés de l'utilisateur ou de son groupe
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

    let data, error

    if (forGroup) {
      // Get user's group first
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', session.userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json({ estimated_budgets: [] })
      }

      // Get group's estimated budgets
      const result = await supabaseServer
        .from('estimated_budgets')
        .select('*')
        .eq('group_id', profile.group_id)
        .order('created_at', { ascending: false })
      
      data = result.data
      error = result.error
    } else {
      // Get user's personal estimated budgets
      const result = await supabaseServer
        .from('estimated_budgets')
        .select('*')
        .eq('profile_id', session.userId)
        .order('created_at', { ascending: false })
      
      data = result.data
      error = result.error
    }

    if (error) {
      console.error('Error fetching estimated budgets:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets estimés' },
        { status: 500 }
      )
    }

    // Calculate spent amount this month for each budget
    const budgetsWithSpending = await Promise.all((data || []).map(async (budget: any) => {
      const currentDate = new Date()
      const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
      const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

      const { data: expenses } = await supabaseServer
        .from('real_expenses')
        .select('amount')
        .eq('estimated_budget_id', budget.id)
        .gte('expense_date', firstDayOfMonth.toISOString().split('T')[0])
        .lte('expense_date', lastDayOfMonth.toISOString().split('T')[0])

      const realExpensesThisMonth = expenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

      // Si monthly_surplus est négatif, c'est un carryover de déficit du mois précédent
      const carryoverSpent = budget.monthly_surplus && budget.monthly_surplus < 0
        ? Math.abs(budget.monthly_surplus)
        : 0

      // Total dépensé = dépenses réelles + carryover du mois précédent
      const spentThisMonth = realExpensesThisMonth + carryoverSpent

      return {
        ...budget,
        spent_this_month: spentThisMonth
      }
    }))

    return NextResponse.json({ estimated_budgets: budgetsWithSpending })
  } catch (error) {
    console.error('Error in GET /api/finances/budgets/estimated:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/finances/budgets/estimated - Crée un nouveau budget estimé
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

    const body: CreateEstimatedBudgetRequest = await request.json()
    const { name, estimated_amount, is_monthly_recurring = true, is_for_group = false } = body

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Le nom du budget est requis' },
        { status: 400 }
      )
    }

    if (!estimated_amount || typeof estimated_amount !== 'number' || estimated_amount <= 0) {
      return NextResponse.json(
        { error: 'Le montant estimé doit être un nombre positif' },
        { status: 400 }
      )
    }

    let insertData: any = {
      name: name.trim(),
      estimated_amount,
      is_monthly_recurring,
      // current_savings calculated dynamically in application
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
          { error: 'Vous devez appartenir à un groupe pour ajouter des budgets de groupe' },
          { status: 400 }
        )
      }

      insertData.group_id = profile.group_id
    } else {
      insertData.profile_id = session.userId
    }

    // Create the estimated budget
    const { data, error } = await supabaseServer
      .from('estimated_budgets')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('Error creating estimated budget:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la création du budget estimé' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      estimated_budget: { ...data, spent_this_month: 0 },
      message: 'Budget estimé créé avec succès'
    })
  } catch (error) {
    console.error('Error in POST /api/finances/budgets/estimated:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/finances/budgets/estimated - Met à jour un budget estimé
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
    const { id, name, estimated_amount, is_monthly_recurring } = body

    if (!id) {
      return NextResponse.json(
        { error: 'ID du budget estimé requis' },
        { status: 400 }
      )
    }

    const updates: any = {}
    
    if (name !== undefined) {
      if (!name || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Le nom ne peut pas être vide' },
          { status: 400 }
        )
      }
      updates.name = name.trim()
    }

    if (estimated_amount !== undefined) {
      if (estimated_amount <= 0) {
        return NextResponse.json(
          { error: 'Le montant estimé doit être positif' },
          { status: 400 }
        )
      }
      updates.estimated_amount = estimated_amount

      // Recalculate savings based on new estimated amount
      const currentDate = new Date()
      const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
      const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

      const { data: expenses } = await supabaseServer
        .from('real_expenses')
        .select('amount')
        .eq('estimated_budget_id', id)
        .gte('expense_date', firstDayOfMonth.toISOString().split('T')[0])
        .lte('expense_date', lastDayOfMonth.toISOString().split('T')[0])

      const spentThisMonth = expenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0
      // current_savings calculated dynamically in application, not stored
    }

    if (is_monthly_recurring !== undefined) {
      updates.is_monthly_recurring = is_monthly_recurring
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'Aucune donnée à mettre à jour' },
        { status: 400 }
      )
    }

    // Update the estimated budget
    const { data, error } = await supabaseServer
      .from('estimated_budgets')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating estimated budget:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du budget estimé' },
        { status: 500 }
      )
    }

    // Calculate spent this month for response
    const currentDate = new Date()
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('amount')
      .eq('estimated_budget_id', id)
      .gte('expense_date', firstDayOfMonth.toISOString().split('T')[0])
      .lte('expense_date', lastDayOfMonth.toISOString().split('T')[0])

    const spentThisMonth = expenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

    return NextResponse.json({
      estimated_budget: { ...data, spent_this_month: spentThisMonth },
      message: 'Budget estimé mis à jour avec succès'
    })
  } catch (error) {
    console.error('Error in PUT /api/finances/budgets/estimated:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/finances/budgets/estimated - Supprime un budget estimé
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
        { error: 'ID du budget estimé requis' },
        { status: 400 }
      )
    }

    // Delete the estimated budget (this will set estimated_budget_id to null in related expenses)
    const { error } = await supabaseServer
      .from('estimated_budgets')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting estimated budget:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression du budget estimé' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Budget estimé supprimé avec succès'
    })
  } catch (error) {
    console.error('Error in DELETE /api/finances/budgets/estimated:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}