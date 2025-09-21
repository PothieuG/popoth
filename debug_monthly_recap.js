/**
 * Script de debug pour le monthly recap
 * À exécuter dans la console du navigateur quand vous êtes connecté
 */

console.log('🔍 DEBUG: Test du monthly recap status...')

// Test de l'API status directement
fetch('/api/monthly-recap/status?context=profile')
  .then(response => {
    console.log('📊 Status Response:', response.status, response.statusText)
    return response.json()
  })
  .then(data => {
    console.log('📊 Status Data:', data)

    if (data.required) {
      console.log('✅ Monthly recap requis - redirection attendue')

      // Test direct de l'API initialize
      console.log('🔍 Test de l\'API initialize...')
      return fetch('/api/monthly-recap/initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ context: 'profile' })
      })
    } else {
      console.log('❌ Monthly recap PAS requis')
      console.log('Raisons possibles:')
      console.log('- isFirstOfMonth =', data.isFirstOfMonth)
      console.log('- hasExistingRecap =', data.hasExistingRecap)
      return null
    }
  })
  .then(response => {
    if (response) {
      console.log('📊 Initialize Response:', response.status, response.statusText)
      return response.json()
    }
    return null
  })
  .then(data => {
    if (data) {
      console.log('📊 Initialize Data:', data)
      if (data.success) {
        console.log('✅ Initialize fonctionne - données récupérées')
      } else {
        console.log('❌ Initialize échoue:', data.error)
      }
    }
  })
  .catch(error => {
    console.error('❌ Erreur lors du test:', error)
  })

// Vérifier aussi les erreurs de console
console.log('🔍 Vérifiez les erreurs dans l\'onglet Console du navigateur')
console.log('🔍 Vérifiez aussi l\'onglet Network pour voir les requêtes HTTP')