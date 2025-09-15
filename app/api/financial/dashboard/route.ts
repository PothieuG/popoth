import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { getProfileFinancialData, getGroupFinancialData, type FinancialData } from '@/lib/financial-calculations'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API Dashboard Financier avec Cache Intelligent
 * Calcule et retourne les données financières pour l'utilisateur connecté
 * - Cache en mémoire de 5 minutes pour éviter les recalculs
 * - Invalidation du cache lors des modifications
 * - Gestion d'erreur robuste avec fallbacks
 */

// Cache en mémoire simple (pour production, utiliser Redis)
interface CacheEntry {
  data: FinancialData
  timestamp: number
  userId: string
}

const cache = new Map<string, CacheEntry>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes en millisecondes

/**
 * Vérifie si une entrée de cache est encore valide
 */
function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_DURATION
}

/**
 * Génère une clé de cache unique pour un utilisateur
 */
function getCacheKey(userId: string, context: 'profile' | 'group', contextId: string): string {
  return `financial_${context}_${contextId}_${userId}`
}

export async function GET(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Récupérer les informations du profil pour savoir si l'utilisateur fait partie d'un groupe
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      console.error('❌ Erreur récupération profil:', profileError)
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    // TEMPORAIRE: Forcer le contexte personnel pour debug
    // TODO: Implémenter la logique de choix profile vs groupe
    const context = 'profile' // Force profile même avec group_id
    const contextId = profile.id // Toujours utiliser profile.id
    const cacheKey = getCacheKey(userId, context, contextId)

    console.log('🎯 Contexte forcé à PROFILE pour debug, groupId ignoré:', profile.group_id)

    // Vérifier le cache
    const cachedEntry = cache.get(cacheKey)
    if (cachedEntry && isCacheValid(cachedEntry)) {
      console.log('📋 CACHE HIT - Données depuis le cache:', {
        cacheKey,
        remainingToLive: cachedEntry.data.remainingToLive,
        availableBalance: cachedEntry.data.availableBalance,
        age: Date.now() - cachedEntry.timestamp
      })
      return NextResponse.json({
        data: cachedEntry.data,
        cached: true,
        context,
        timestamp: cachedEntry.timestamp
      })
    } else {
      console.log('📋 CACHE MISS - Recalcul nécessaire:', {
        cacheKey,
        hasEntry: !!cachedEntry,
        isValid: cachedEntry ? isCacheValid(cachedEntry) : false
      })
    }

    // Calculer les données financières selon le contexte
    let financialData: FinancialData

    // TEMPORAIRE: Toujours utiliser le calcul profile
    financialData = await getProfileFinancialData(profile.id)
    console.log('👤 Calcul PROFILE forcé terminé:', profile.id)

    // Mettre en cache les résultats
    cache.set(cacheKey, {
      data: financialData,
      timestamp: Date.now(),
      userId
    })

    console.log('📋 NOUVEAU CALCUL - Données mises en cache:', {
      cacheKey,
      remainingToLive: financialData.remainingToLive,
      availableBalance: financialData.availableBalance,
      totalEstimatedIncome: financialData.totalEstimatedIncome,
      totalEstimatedBudgets: financialData.totalEstimatedBudgets
    })

    return NextResponse.json({
      data: financialData,
      cached: false,
      context,
      timestamp: Date.now()
    })

  } catch (error) {
    console.error('❌ Erreur dans GET /api/financial/dashboard:', error)

    // En cas d'erreur, retourner des données par défaut pour éviter de casser l'UI
    return NextResponse.json({
      data: {
        availableBalance: 0,
        remainingToLive: 0,
        totalSavings: 0,
        totalEstimatedIncome: 0,
        totalEstimatedBudgets: 0,
        totalRealIncome: 0,
        totalRealExpenses: 0
      },
      cached: false,
      context: 'profile',
      timestamp: Date.now(),
      error: 'Données par défaut - erreur de calcul'
    }, { status: 200 }) // 200 pour éviter de casser l'UI
  }
}

/**
 * Route pour invalider le cache (appelée lors de modifications de budgets/revenus)
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔄 API /api/financial/dashboard POST - Invalidation cache DEMANDÉE')

    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId

    if (!userId) {
      console.log('❌ Invalidation refusée - utilisateur non autorisé')
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    console.log('👤 Invalidation cache pour userId:', userId)

    // Récupérer le profil pour connaître le contexte
    const { data: profile } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (profile) {
      // Invalider le cache pour le profil
      const profileCacheKey = getCacheKey(userId, 'profile', profile.id)
      const profileDeleted = cache.delete(profileCacheKey)
      console.log('🗑️ Cache profile supprimé:', profileCacheKey, '→', profileDeleted)

      // Invalider le cache pour le groupe si applicable
      if (profile.group_id) {
        const groupCacheKey = getCacheKey(userId, 'group', profile.group_id)
        const groupDeleted = cache.delete(groupCacheKey)
        console.log('🗑️ Cache groupe supprimé:', groupCacheKey, '→', groupDeleted)
      }

      // Afficher l'état du cache après suppression
      console.log('📊 État cache après invalidation - Taille:', cache.size)
      console.log('📊 Clés restantes:', Array.from(cache.keys()))

      console.log('✅ Cache invalidé avec succès pour userId:', userId)
    } else {
      console.log('❌ Profil non trouvé pour invalidation')
    }

    return NextResponse.json({
      success: true,
      message: 'Cache invalidé avec succès'
    })

  } catch (error) {
    console.error('❌ Erreur lors de l\'invalidation du cache:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

/**
 * Route pour obtenir les statistiques du cache (développement/debug)
 */
export async function DELETE(request: NextRequest) {
  try {
    console.log('🔄 API /api/financial/dashboard DELETE - Stats cache')

    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const cacheStats = {
      totalEntries: cache.size,
      entries: Array.from(cache.entries()).map(([key, entry]) => ({
        key,
        timestamp: entry.timestamp,
        age: Date.now() - entry.timestamp,
        isValid: isCacheValid(entry),
        userId: entry.userId
      }))
    }

    return NextResponse.json({
      cacheStats,
      cacheSize: cache.size,
      cacheDuration: CACHE_DURATION
    })

  } catch (error) {
    console.error('❌ Erreur lors de la récupération des stats cache:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}