import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

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
 * GET /api/finances/income/estimated - Récupère les revenus estimés
 * Retourne les revenus estimés de l'utilisateur ou de son groupe
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const logContext = {
    component: '/api/finances/income/estimated',
    operation: 'fetch_estimated_incomes',
    timestamp: new Date().toISOString()
  }
  
  console.log('📖 Fetching estimated incomes', {
    ...logContext,
    level: 'info'
  })
  
  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      console.log('❌ Authentication failed', {
        ...logContext,
        level: 'warn',
        error: 'no_session'
      })
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const forGroup = url.searchParams.get('group') === 'true'
    
    console.log('🔍 Query context', {
      ...logContext,
      level: 'debug',
      userId: session.userId,
      forGroup: forGroup
    })

    let data, error

    if (forGroup) {
      // Get user's group first
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', session.userId)
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
        .eq('profile_id', session.userId)
        .order('created_at', { ascending: false })
      
      data = result.data
      error = result.error
    }

    if (error) {
      console.error('Error fetching estimated incomes:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des revenus estimés' },
        { status: 500 }
      )
    }

    console.log('✅ Estimated incomes fetched successfully', {
      ...logContext,
      level: 'info',
      userId: session.userId,
      forGroup: forGroup,
      count: data?.length || 0,
      duration: Date.now() - startTime
    })
    
    return NextResponse.json({ estimated_incomes: data || [] })
  } catch (error) {
    console.error('❌ Error fetching estimated incomes', {
      ...logContext,
      level: 'error',
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      duration: Date.now() - startTime
    })
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/finances/income/estimated - Crée un nouveau revenu estimé
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

    const body: CreateEstimatedIncomeRequest = await request.json()
    const { name, estimated_amount, is_monthly_recurring = true, is_for_group = false } = body

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Le nom du revenu est requis' },
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
      is_monthly_recurring
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
          { error: 'Vous devez appartenir à un groupe pour ajouter des revenus de groupe' },
          { status: 400 }
        )
      }

      insertData.group_id = profile.group_id
    } else {
      insertData.profile_id = session.userId
    }

    // Create the estimated income
    const { data, error } = await supabaseServer
      .from('estimated_incomes')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('Error creating estimated income:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la création du revenu estimé' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      estimated_income: data,
      message: 'Revenu estimé créé avec succès'
    })
  } catch (error) {
    console.error('Error in POST /api/finances/income/estimated:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/finances/income/estimated - Met à jour un revenu estimé
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
        { error: 'ID du revenu estimé requis' },
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

    // Update the estimated income
    const { data, error } = await supabaseServer
      .from('estimated_incomes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating estimated income:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du revenu estimé' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      estimated_income: data,
      message: 'Revenu estimé mis à jour avec succès'
    })
  } catch (error) {
    console.error('Error in PUT /api/finances/income/estimated:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/finances/income/estimated - Supprime un revenu estimé
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
        { error: 'ID du revenu estimé requis' },
        { status: 400 }
      )
    }

    // Delete the estimated income
    const { error } = await supabaseServer
      .from('estimated_incomes')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting estimated income:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la suppression du revenu estimé' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: 'Revenu estimé supprimé avec succès'
    })
  } catch (error) {
    console.error('Error in DELETE /api/finances/income/estimated:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}