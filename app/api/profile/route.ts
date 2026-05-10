import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuth } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'

export interface ProfileData {
  id: string
  first_name: string
  last_name: string
  salary: number
  group_id: string | null
  group_name: string | null
  avatar_url: string | null
  created_at: string | null
  updated_at: string | null
}

export interface CreateProfileRequest {
  first_name: string
  last_name: string
  salary?: number
  avatar_url?: string | null
}

/**
 * GET /api/profile - Récupère le profil de l'utilisateur connecté
 * Retourne les données du profil ou null si aucun profil n'existe
 */
export const GET = withAuth(async (_request, { userId }) => {
  try {
    // Récupérer le profil depuis Supabase (full row — withAuthAndProfile's
    // narrow select would lose salary/avatar_url/timestamps; the 200-on-no-
    // profile fallback below also rules it out)
    const { data, error } = await supabaseServer
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      // Si le profil n'existe pas, ce n'est pas une erreur
      if (error.code === 'PGRST116') {
        return NextResponse.json({ profile: null })
      }

      logger.error('❌ Erreur Supabase lors de la récupération du profil:', error)
      return NextResponse.json({ error: `Erreur Supabase: ${error.message}` }, { status: 500 })
    }

    // Get group information if user belongs to a group
    let groupName: string | null = null
    if (data.group_id) {
      const { data: groupData } = await supabaseServer
        .from('groups')
        .select('name')
        .eq('id', data.group_id)
        .single()

      groupName = groupData?.name || null
    }

    // Format the profile data to include group information
    const profileData: ProfileData = {
      id: data.id,
      first_name: data.first_name,
      last_name: data.last_name,
      salary: data.salary || 0,
      group_id: data.group_id,
      group_name: groupName,
      avatar_url: data.avatar_url || null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    }

    return NextResponse.json({ profile: profileData })
  } catch (error) {
    return NextResponse.json(
      { error: `Erreur interne: ${error instanceof Error ? error.message : 'Erreur inconnue'}` },
      { status: 500 },
    )
  }
})

/**
 * POST /api/profile - Crée un nouveau profil pour l'utilisateur connecté
 * Prend en paramètre first_name et last_name
 */
export const POST = withAuth(async (request, { userId }) => {
  try {
    // Parser les données de la requête
    const body = (await request.json()) as CreateProfileRequest
    const { first_name, last_name, salary } = body

    // Validation des données
    if (!first_name || !last_name) {
      return NextResponse.json({ error: 'Le prénom et le nom sont requis' }, { status: 400 })
    }

    if (first_name.trim().length < 1 || last_name.trim().length < 1) {
      return NextResponse.json(
        { error: 'Le prénom et le nom ne peuvent pas être vides' },
        { status: 400 },
      )
    }

    // Validation du salaire (requis)
    if (salary !== undefined && (salary <= 0 || salary > 999999.99)) {
      return NextResponse.json(
        { error: 'Le salaire doit être entre 1 et 999,999.99 €' },
        { status: 400 },
      )
    }

    // Créer le profil dans Supabase
    const { data, error } = await supabaseServer
      .from('profiles')
      .insert({
        id: userId,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        salary: salary || 1,
      })
      .select()
      .single()

    if (error) {
      // Si le profil existe déjà
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Un profil existe déjà pour cet utilisateur' },
          { status: 409 },
        )
      }

      logger.error('❌ Erreur Supabase lors de la création du profil:', error)
      return NextResponse.json({ error: `Erreur Supabase: ${error.message}` }, { status: 500 })
    }

    // Format the profile data
    const profileData: ProfileData = {
      id: data.id,
      first_name: data.first_name,
      last_name: data.last_name,
      salary: data.salary || 0,
      group_id: data.group_id,
      group_name: null, // Nouveau profil n'a pas de groupe
      avatar_url: data.avatar_url || null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    }

    return NextResponse.json({
      profile: profileData,
      message: 'Profil créé avec succès',
    })
  } catch (error) {
    return NextResponse.json(
      { error: `Erreur interne: ${error instanceof Error ? error.message : 'Erreur inconnue'}` },
      { status: 500 },
    )
  }
})

/**
 * PUT /api/profile - Met à jour le profil de l'utilisateur connecté
 * Prend en paramètre first_name et/ou last_name
 */
export const PUT = withAuth(async (request, { userId }) => {
  try {
    // Parser les données de la requête
    const body = await request.json()
    const updates: Partial<CreateProfileRequest> = {}

    // Valider et préparer les mises à jour
    if (body.first_name !== undefined) {
      if (!body.first_name || body.first_name.trim().length < 1) {
        return NextResponse.json({ error: 'Le prénom ne peut pas être vide' }, { status: 400 })
      }
      updates.first_name = body.first_name.trim()
    }

    if (body.last_name !== undefined) {
      if (!body.last_name || body.last_name.trim().length < 1) {
        return NextResponse.json({ error: 'Le nom ne peut pas être vide' }, { status: 400 })
      }
      updates.last_name = body.last_name.trim()
    }

    if (body.salary !== undefined) {
      if (body.salary <= 0 || body.salary > 999999.99) {
        return NextResponse.json(
          { error: 'Le salaire doit être entre 1 et 999,999.99 €' },
          { status: 400 },
        )
      }
      updates.salary = body.salary
    }

    if (body.avatar_url !== undefined) {
      updates.avatar_url = body.avatar_url
    }

    // Vérifier qu'il y a au moins une mise à jour
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Aucune donnée à mettre à jour' }, { status: 400 })
    }

    // Mettre à jour le profil dans Supabase
    const { data, error } = await supabaseServer
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select('*')
      .single()

    if (error) {
      logger.error('Erreur lors de la mise à jour du profil:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du profil' },
        { status: 500 },
      )
    }

    // Get group information if user belongs to a group
    let groupName: string | null = null
    if (data.group_id) {
      const { data: groupData } = await supabaseServer
        .from('groups')
        .select('name')
        .eq('id', data.group_id)
        .single()

      groupName = groupData?.name || null
    }

    // Format the profile data to include group information
    const profileData: ProfileData = {
      id: data.id,
      first_name: data.first_name,
      last_name: data.last_name,
      salary: data.salary || 0,
      group_id: data.group_id,
      group_name: groupName,
      avatar_url: data.avatar_url || null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    }

    return NextResponse.json({
      profile: profileData,
      message: 'Profil mis à jour avec succès',
    })
  } catch {
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
