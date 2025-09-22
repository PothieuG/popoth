#!/usr/bin/env node

/**
 * Script de test pour l'équilibrage automatique du reste à vivre
 *
 * Usage: node scripts/test-balance.js [scenario]
 *
 * Scénarios disponibles:
 * - surplus_only: Budgets avec surplus uniquement
 * - deficit_only: Budgets déficitaires uniquement
 * - mixed_scenario: Mix de budgets excédentaires et déficitaires
 * - with_savings: Budgets avec économies accumulées
 * - negative_remaining: Reste à vivre négatif avec excédents disponibles
 * - all: Execute tous les scénarios
 */

const https = require('https')
const http = require('http')

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

// Configuration pour ignorer les certificats SSL auto-signés en dev
const httpAgent = new http.Agent({})
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
})

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http
    const agent = url.startsWith('https:') ? httpsAgent : httpAgent

    const req = protocol.request(url, {
      ...options,
      agent
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data)
          resolve({ status: res.statusCode, data: jsonData })
        } catch (error) {
          resolve({ status: res.statusCode, data: data })
        }
      })
    })

    req.on('error', reject)

    if (options.body) {
      req.write(options.body)
    }

    req.end()
  })
}

async function getAvailableScenarios() {
  try {
    const response = await makeRequest(`${BASE_URL}/api/debug/test-balance`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (response.status === 200) {
      return response.data.scenarios
    } else {
      throw new Error(`Erreur ${response.status}: ${JSON.stringify(response.data)}`)
    }
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des scénarios:', error.message)
    return []
  }
}

async function runTestScenario(scenario) {
  console.log(`\n🧪 Démarrage du test "${scenario}"...`)
  console.log('='.repeat(50))

  try {
    const response = await makeRequest(`${BASE_URL}/api/debug/test-balance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ scenario })
    })

    if (response.status === 200) {
      const result = response.data

      console.log(`✅ Test "${scenario}" terminé avec succès`)
      console.log(`📊 Résumé: ${result.verification.summary}`)

      // Afficher les détails du test
      console.log('\n📋 Détails des vérifications:')
      result.verification.tests.forEach(test => {
        const status = test.passed ? '✅' : '❌'
        console.log(`  ${status} ${test.name}`)
        console.log(`     Attendu: ${test.expected}`)
        console.log(`     Obtenu:  ${test.actual}`)
      })

      // Afficher l'état initial
      if (result.balanceResult.initialState) {
        const initial = result.balanceResult.initialState
        console.log('\n💰 État initial:')
        console.log(`  - Reste à vivre: ${initial.current_remaining_to_live}€`)
        console.log(`  - Total surplus: ${initial.total_surplus}€`)
        console.log(`  - Total déficit: ${initial.total_deficit}€`)
      }

      // Afficher le résultat de l'équilibrage si appliqué
      if (result.balanceResult.balanceApplied && result.balanceResult.balanceResult) {
        const balance = result.balanceResult.balanceResult
        console.log('\n⚖️ Résultat équilibrage:')
        console.log(`  - Reste à vivre original: ${balance.original_remaining_to_live}€`)
        console.log(`  - Reste à vivre final: ${balance.final_remaining_to_live}€`)
        console.log(`  - Montant redistribué: ${balance.deficit_covered}€`)
        console.log(`  - Déficit restant: ${balance.remaining_deficit}€`)
      }

      return result.verification.success
    } else {
      console.error(`❌ Erreur ${response.status}:`, response.data)
      return false
    }
  } catch (error) {
    console.error(`❌ Erreur lors du test "${scenario}":`, error.message)
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)
  const requestedScenario = args[0]

  console.log('🚀 Script de test pour l\'équilibrage automatique')
  console.log(`🌐 URL de base: ${BASE_URL}`)

  // Vérifier que le serveur est accessible
  try {
    await makeRequest(`${BASE_URL}/api/debug/test-balance`, { method: 'GET' })
  } catch (error) {
    console.error('❌ Impossible de se connecter au serveur. Assurez-vous que le serveur de développement est démarré.')
    console.error('   Commande: npm run dev ou pnpm run dev')
    process.exit(1)
  }

  // Récupérer les scénarios disponibles
  const scenarios = await getAvailableScenarios()

  if (scenarios.length === 0) {
    console.error('❌ Aucun scénario disponible')
    process.exit(1)
  }

  // Afficher l'aide si aucun argument ou argument invalide
  if (!requestedScenario || (requestedScenario !== 'all' && !scenarios.find(s => s.name === requestedScenario))) {
    console.log('\n📚 Scénarios disponibles:')
    scenarios.forEach(scenario => {
      console.log(`  - ${scenario.name}: ${scenario.description}`)
      console.log(`    Comportement attendu: ${scenario.expectedBehavior}`)
    })
    console.log('  - all: Execute tous les scénarios')

    console.log('\n💡 Usage:')
    console.log(`  node scripts/test-balance.js [scenario]`)
    console.log(`  node scripts/test-balance.js negative_remaining`)
    console.log(`  node scripts/test-balance.js all`)

    process.exit(0)
  }

  // Exécuter le(s) test(s)
  let results = []

  if (requestedScenario === 'all') {
    console.log(`\n🎯 Exécution de tous les scénarios (${scenarios.length})...`)

    for (const scenario of scenarios) {
      const success = await runTestScenario(scenario.name)
      results.push({ scenario: scenario.name, success })
    }
  } else {
    const success = await runTestScenario(requestedScenario)
    results.push({ scenario: requestedScenario, success })
  }

  // Résumé final
  console.log('\n' + '='.repeat(50))
  console.log('🎯 RÉSUMÉ FINAL')
  console.log('='.repeat(50))

  const successCount = results.filter(r => r.success).length
  const totalCount = results.length

  results.forEach(result => {
    const status = result.success ? '✅' : '❌'
    console.log(`${status} ${result.scenario}`)
  })

  console.log(`\n📊 Résultat global: ${successCount}/${totalCount} tests réussis`)

  if (successCount === totalCount) {
    console.log('🎉 Tous les tests sont passés avec succès!')
    process.exit(0)
  } else {
    console.log('⚠️ Certains tests ont échoué.')
    process.exit(1)
  }
}

// Gestion des erreurs non capturées
process.on('unhandledRejection', (error) => {
  console.error('❌ Erreur non gérée:', error)
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  console.error('❌ Exception non capturée:', error)
  process.exit(1)
})

// Exécuter le script
main().catch(error => {
  console.error('❌ Erreur fatale:', error)
  process.exit(1)
})