import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { validateSessionToken } from '@/lib/session-server'

export interface ProfileData {
  id: string
  first_name: string
  last_name: string
  salary: number
  group_id: string | null
  group_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
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
export async function GET(request: NextRequest) {
  try {
    console.log('🔍 GET /api/profile - Début')
    
    // Valider la session utilisateur
    const sessionData = await validateSessionToken(request)
    console.log('📋 Session data:', { userId: sessionData?.userId })
    
    if (!sessionData?.userId) {
      console.log('❌ Session invalide')
      return NextResponse.json(
        { error: 'Non autorisé' },
        { status: 401 }
      )
    }

    // Récupérer le profil depuis Supabase
    console.log('🔍 Requête Supabase pour userId:', sessionData.userId)
    const { data, error } = await supabaseServer
      .from('profiles')
      .select('*')
      .eq('id', sessionData.userId)
      .single()

    console.log('📊 Réponse Supabase:', { data, error })

    if (error) {
      // Si le profil n'existe pas, ce n'est pas une erreur
      if (error.code === 'PGRST116') {
        console.log('✅ Aucun profil trouvé (normal pour première connexion)')
        return NextResponse.json({ profile: null })
      }
      
      console.error('❌ Erreur Supabase lors de la récupération du profil:', error)
      return NextResponse.json(
        { error: `Erreur Supabase: ${error.message}` },
        { status: 500 }
      )
    }

    console.log('✅ Profil récupéré avec succès:', data)
    
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
      updated_at: data.updated_at
    }
    
    return NextResponse.json({ profile: profileData })
  } catch (error) {
    console.error('❌ Erreur inattendue lors de la récupération du profil:', error)
    return NextResponse.json(
      { error: `Erreur interne: ${error instanceof Error ? error.message : 'Erreur inconnue'}` },
      { status: 500 }
    )
  }
}

/**
 * POST /api/profile - Crée un nouveau profil pour l'utilisateur connecté
 * Prend en paramètre first_name et last_name
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🚀 POST /api/profile - Début')
    
    // Valider la session utilisateur
    const sessionData = await validateSessionToken(request)
    console.log('📋 Session data:', { userId: sessionData?.userId })
    
    if (!sessionData?.userId) {
      console.log('❌ Session invalide')
      return NextResponse.json(
        { error: 'Non autorisé' },
        { status: 401 }
      )
    }

    // Parser les données de la requête
    const body = await request.json() as CreateProfileRequest
    const { first_name, last_name, salary } = body
    console.log('📝 Données reçues:', { first_name, last_name, salary })

    // Validation des données
    if (!first_name || !last_name) {
      console.log('❌ Données manquantes')
      return NextResponse.json(
        { error: 'Le prénom et le nom sont requis' },
        { status: 400 }
      )
    }

    if (first_name.trim().length < 1 || last_name.trim().length < 1) {
      console.log('❌ Données vides après trim')
      return NextResponse.json(
        { error: 'Le prénom et le nom ne peuvent pas être vides' },
        { status: 400 }
      )
    }

    // Validation du salaire (requis)
    if (salary !== undefined && (salary <= 0 || salary > 999999.99)) {
      console.log('❌ Salaire invalide')
      return NextResponse.json(
        { error: 'Le salaire doit être entre 1 et 999,999.99 €' },
        { status: 400 }
      )
    }

    // Créer le profil dans Supabase
    console.log('💾 Insertion dans Supabase avec userId:', sessionData.userId)
    const { data, error } = await supabaseServer
      .from('profiles')
      .insert({
        id: sessionData.userId,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        salary: salary || 1
      })
      .select()
      .single()

    console.log('📊 Réponse Supabase:', { data, error })

    if (error) {
      // Si le profil existe déjà
      if (error.code === '23505') {
        console.log('⚠️ Profil existe déjà')
        return NextResponse.json(
          { error: 'Un profil existe déjà pour cet utilisateur' },
          { status: 409 }
        )
      }

      console.error('❌ Erreur Supabase lors de la création du profil:', error)
      return NextResponse.json(
        { error: `Erreur Supabase: ${error.message}` },
        { status: 500 }
      )
    }

    console.log('✅ Profil créé avec succès:', data)
    
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
      updated_at: data.updated_at
    }
    
    return NextResponse.json({ 
      profile: profileData,
      message: 'Profil créé avec succès'
    })
  } catch (error) {
    console.error('❌ Erreur inattendue lors de la création du profil:', error)
    return NextResponse.json(
      { error: `Erreur interne: ${error instanceof Error ? error.message : 'Erreur inconnue'}` },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/profile - Met à jour le profil de l'utilisateur connecté
 * Prend en paramètre first_name et/ou last_name
 */
export async function PUT(request: NextRequest) {
  try {
    // Valider la session utilisateur
    const sessionData = await validateSessionToken(request)
    console.log('🔍 Session data for PUT:', sessionData)
    if (!sessionData?.userId) {
      return NextResponse.json(
        { error: 'Non autorisé' },
        { status: 401 }
      )
    }

    console.log('👤 User ID for update:', sessionData.userId, 'type:', typeof sessionData.userId)

    // Parser les données de la requête
    const body = await request.json()
    const updates: Partial<CreateProfileRequest> = {}

    // Valider et préparer les mises à jour
    if (body.first_name !== undefined) {
      if (!body.first_name || body.first_name.trim().length < 1) {
        return NextResponse.json(
          { error: 'Le prénom ne peut pas être vide' },
          { status: 400 }
        )
      }
      updates.first_name = body.first_name.trim()
    }

    if (body.last_name !== undefined) {
      if (!body.last_name || body.last_name.trim().length < 1) {
        return NextResponse.json(
          { error: 'Le nom ne peut pas être vide' },
          { status: 400 }
        )
      }
      updates.last_name = body.last_name.trim()
    }

    if (body.salary !== undefined) {
      if (body.salary <= 0 || body.salary > 999999.99) {
        return NextResponse.json(
          { error: 'Le salaire doit être entre 1 et 999,999.99 €' },
          { status: 400 }
        )
      }
      updates.salary = body.salary
    }

    if (body.avatar_url !== undefined) {
      updates.avatar_url = body.avatar_url
    }

    // Vérifier qu'il y a au moins une mise à jour
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'Aucune donnée à mettre à jour' },
        { status: 400 }
      )
    }

    // Vérifier que userId est valide avant la requête
    if (!sessionData.userId || sessionData.userId === 'null' || sessionData.userId === null) {
      console.error('❌ User ID invalide:', sessionData.userId)
      return NextResponse.json(
        { error: 'ID utilisateur invalide' },
        { status: 400 }
      )
    }

    console.log('💾 Updating profile for userId:', sessionData.userId, 'with:', updates)

    // Mettre à jour le profil dans Supabase
    const { data, error } = await supabaseServer
      .from('profiles')
      .update(updates)
      .eq('id', sessionData.userId)
      .select('*')
      .single()

    if (error) {
      console.error('Erreur lors de la mise à jour du profil:', error)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du profil' },
        { status: 500 }
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
      updated_at: data.updated_at
    }

    return NextResponse.json({ 
      profile: profileData,
      message: 'Profil mis à jour avec succès'
    })
  } catch (error) {
    console.error('Erreur inattendue lors de la mise à jour du profil:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}