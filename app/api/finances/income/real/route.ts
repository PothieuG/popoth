import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import FinancialLogger from '@/lib/financial-logger'

export interface RealIncomeEntryData {
  id: string
  profile_id?: string
  group_id?: string
  estimated_income_id?: string
  amount: number
  description: string
  entry_date: string
  is_exceptional: boolean
  created_at: string
  estimated_income?: {
    name: string
  }
}

export interface CreateRealIncomeEntryRequest {
  amount: number
  description: string
  entry_date?: string
  estimated_income_id?: string
  is_for_group?: boolean
}

/**
 * GET /api/finances/income/real - Récupère les entrées réelles d'argent
 * Retourne les entrées d'argent de l'utilisateur ou de son groupe
 */
export async function GET(request: NextRequest) {
  const { operationId, startTime, log } = FinancialLogger.startOperation({
    component: '/api/finances/income/real',
    operation: 'fetch_real_income_entries'
  })
  
  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      FinancialLogger.authError({
        component: '/api/finances/income/real',
        operation: 'fetch_real_income_entries',
        operationId
      })
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }
    
    log({
      level: 'debug',
      userId: session.userId,
      message: 'Session validated successfully'
    })

    const url = new URL(request.url)
    const forGroup = url.searchParams.get('group') === 'true'
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')

    let query = supabaseServer
      .from('real_income_entries')
      .select(`
        *,
        estimated_income:estimated_incomes(name)
      `)
      .order('entry_date', { ascending: false })
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
        return NextResponse.json({ real_income_entries: [], total: 0 })
      }

      query = query.eq('group_id', profile.group_id)
    } else {
      query = query.eq('profile_id', session.userId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching real income entries:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des entrées d\'argent' },
        { status: 500 }
      )
    }

    // Get total count for pagination
    let countQuery = supabaseServer
      .from('real_income_entries')
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

    const { count } = await countQuery

    return NextResponse.json({ 
      real_income_entries: data || [], 
      total: count || 0,
      limit,
      offset
    })
  } catch (error) {
    console.error('Error in GET /api/finances/income/real:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/finances/income/real - Crée une nouvelle entrée réelle d'argent
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

    const body: CreateRealIncomeEntryRequest = await request.json()
    const { 
      amount, 
      description, 
      entry_date, 
      estimated_income_id,
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
      entry_date: entry_date || new Date().toISOString().split('T')[0],
      is_exceptional: !estimated_income_id
    }

    if (estimated_income_id) {
      // Verify that the estimated income exists and belongs to the user/group
      const { data: estimatedIncome, error: verifyError } = await supabaseServer
        .from('estimated_incomes')
        .select('id, profile_id, group_id')
        .eq('id', estimated_income_id)
        .single()

      if (verifyError || !estimatedIncome) {
        return NextResponse.json(
          { error: 'Revenu estimé introuvable' },
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

        if (!profile?.group_id || estimatedIncome.group_id !== profile.group_id) {
          return NextResponse.json(
            { error: 'Revenu estimé non autorisé pour ce groupe' },
            { status: 403 }
          )
        }
      } else {
        if (estimatedIncome.profile_id !== session.userId) {
          return NextResponse.json(
            { error: 'Revenu estimé non autorisé pour cet utilisateur' },
            { status: 403 }
          )
        }
      }

      insertData.estimated_income_id = estimated_income_id
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
          { error: 'Vous devez appartenir à un groupe pour ajouter des entrées de groupe' },
          { status: 400 }
        )
      }

      insertData.group_id = profile.group_id
    } else {
      insertData.profile_id = session.userId
    }

    // Create the real income entry
    const { data, error } = await supabaseServer
      .from('real_income_entries')
      .insert(insertData)
      .select(`
        *,
        estimated_income:estimated_incomes(name)
      `)
      .single()

    if (error) {
      console.error('Error creating real income entry:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la création de l\'entrée d\'argent' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      real_income_entry: data,
      message: 'Entrée d\'argent créée avec succès'
    })
  } catch (error) {
    console.error('Error in POST /api/finances/income/real:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/finances/income/real - Met à jour une entrée réelle d'argent
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
    const { id, amount, description, entry_date, estimated_income_id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'ID de l\'entrée d\'argent requis' },
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

    if (entry_date !== undefined) {
      updates.entry_date = entry_date
    }

    if (estimated_income_id !== undefined) {
      updates.estimated_income_id = estimated_income_id
      updates.is_exceptional = !estimated_income_id
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'Aucune donnée à mettre à jour' },
        { status: 400 }
      )
    }

    // Update the real income entry
    const { data, error } = await supabaseServer
      .from('real_income_entries')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        estimated_income:estimated_incomes(name)
      `)
      .single()

    if (error) {
      console.error('Error updating real income entry:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour de l\'entrée d\'argent' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      real_income_entry: data,
      message: 'Entrée d\'argent mise à jour avec succès'
    })
  } catch (error) {
    console.error('Error in PUT /api/finances/income/real:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/finances/income/real - Supprime une entrée réelle d'argent
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
        { error: 'ID de l\'entrée d\'argent requis' },
        { status: 400 }
      )
    }

    // Delete the real income entry
    const { error } = await supabaseServer
      .from('real_income_entries')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting real income entry:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression de l\'entrée d\'argent' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Entrée d\'argent supprimée avec succès'
    })
  } catch (error) {
    console.error('Error in DELETE /api/finances/income/real:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}