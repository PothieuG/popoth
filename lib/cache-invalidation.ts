/**
 * Utilitaires pour l'invalidation automatique du cache financier
 * Appelé automatiquement après chaque modification de planification
 */

import { NextRequest } from 'next/server'

/**
 * Invalide le cache du dashboard financier pour rafraîchir les données immédiatement
 * Fonction utilitaire pour éviter la duplication de code dans les APIs
 */
export async function invalidateFinancialCache(request: NextRequest): Promise<boolean> {
  try {
    console.log('🔄 Invalidation du cache financier...')

    // Extraire l'origine de l'URL de la requête
    const origin = request.url.split('/api')[0]

    const invalidateResponse = await fetch(`${origin}/api/financial/dashboard`, {
      method: 'POST',
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
        'Cookie': request.headers.get('Cookie') || '',
        'Content-Type': 'application/json'
      }
    })

    if (invalidateResponse.ok) {
      console.log('✅ Cache dashboard invalidé avec succès')
      return true
    } else {
      console.log('⚠️ Échec invalidation cache - status:', invalidateResponse.status)
      return false
    }

  } catch (error) {
    console.log('⚠️ Erreur lors de l\'invalidation cache (non critique):', error)
    return false
  }
}

/**
 * Combine la sauvegarde du snapshot ET l'invalidation du cache
 * Fonction tout-en-un pour simplifier l'usage dans les APIs
 */
export async function saveSnapshotAndInvalidateCache(
  request: NextRequest,
  saveSnapshotPromise: Promise<boolean>
): Promise<{ snapshotSaved: boolean; cacheInvalidated: boolean }> {

  // Exécuter les deux opérations en parallèle pour optimiser les performances
  const [snapshotSaved, cacheInvalidated] = await Promise.all([
    saveSnapshotPromise,
    invalidateFinancialCache(request)
  ])

  // Log des résultats
  if (snapshotSaved) {
    console.log('📊 Snapshot reste à vivre sauvegardé avec succès')
  } else {
    console.log('⚠️ Échec sauvegarde snapshot (non critique)')
  }

  if (cacheInvalidated) {
    console.log('🔄 Cache dashboard invalidé avec succès')
  } else {
    console.log('⚠️ Échec invalidation cache (non critique)')
  }

  return { snapshotSaved, cacheInvalidated }
}