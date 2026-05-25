// Scénario "random-profile" — état aléatoire pour USER_A (gilles.pothieu@gmail.com).
//
// Reset le mois courant + seed un état "frais" avec :
//   - 1 salaire random (1500-4500€)
//   - 1 tirelire random (0-500€)
//   - 1 solde bancaire random (500-3500€)
//   - 3-6 budgets piochés au hasard dans un pool de catégories réalistes
//   - 1-3 dépenses par budget (factor 0.4-1.3 × estimated → mix surplus/déficit)
//   - 0-2 revenus exceptionnels optionnels (30% chance)
//   - 0-50€ d'économies pré-existantes sur ~50% des budgets (pour permettre la
//     cascade savings dans le bilan négatif si le random produit un déficit)
//
// État résultant : status='no_recap' (aucune ligne monthly_recaps). Le wizard
// s'ouvre sur l'écran "Bienvenue" → tu peux tester la cascade complète
// (Commencer → Compléter le mois → Récap général → Bilan ± → Salaire → Final).
//
// Re-run = re-cleanup + re-seed (nouveau random à chaque exécution).
//
// Usage:
//   node scripts/seed-recap/random-profile.mjs

import {
  cleanupCurrentMonth,
  setProfileSalary,
  setPiggy,
  setBank,
  insertProfileBudgets,
  insertProfileExpenses,
  insertProfileRealIncomes,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
} from './_lib.mjs'

// --- Random helpers (zero dep) ---------------------------------------------
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function randFactor(min, max) {
  return Math.random() * (max - min) + min
}
function chance(probability) {
  return Math.random() < probability
}
function pickN(arr, n) {
  const copy = [...arr]
  const picked = []
  while (picked.length < n && copy.length > 0) {
    const idx = Math.floor(Math.random() * copy.length)
    picked.push(copy.splice(idx, 1)[0])
  }
  return picked
}
function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// --- Pools réalistes pour avoir des libellés crédibles à l'écran ------------
const BUDGET_POOL = [
  { name: 'Courses', min: 200, max: 600 },
  { name: 'Loisirs', min: 80, max: 250 },
  { name: 'Transport', min: 50, max: 200 },
  { name: 'Restaurants', min: 50, max: 250 },
  { name: 'Sport', min: 30, max: 150 },
  { name: 'Vêtements', min: 50, max: 200 },
  { name: 'Santé', min: 30, max: 150 },
  { name: 'Abonnements', min: 30, max: 100 },
  { name: 'Beauté', min: 30, max: 120 },
  { name: 'Maison', min: 50, max: 200 },
]

const EXPENSE_DESCRIPTIONS = {
  Courses: ['Carrefour', 'Lidl', 'Monoprix', 'Picard', 'Marché'],
  Loisirs: ['Ciné', 'Concert', 'Musée', 'Livres', 'Sortie'],
  Transport: ['Pass Navigo', 'Uber', 'Essence', 'Train', 'Parking'],
  Restaurants: ['Burger', 'Sushi', 'Brunch', 'Pizzeria', 'Asiatique'],
  Sport: ['Salle de sport', 'Équipement', 'Inscription course', 'Yoga'],
  Vêtements: ['Zara', 'Uniqlo', 'Chaussures', 'H&M'],
  Santé: ['Pharmacie', 'Médecin', 'Mutuelle', 'Ostéo'],
  Abonnements: ['Netflix', 'Spotify', 'Internet', 'iCloud'],
  Beauté: ['Coiffeur', 'Cosmétiques', 'Soins'],
  Maison: ['Ikea', 'Outils', 'Décoration', 'Bricolage'],
}

const INCOME_DESCRIPTIONS = [
  'Remboursement copain',
  'Cadeau anniversaire',
  'Vente Vinted',
  'Bonus annuel',
  'Mission freelance',
  'Cashback',
]

runScenario('random-profile', async () => {
  // 1. Wipe le mois courant pour repartir d'une page blanche.
  await cleanupCurrentMonth({ profile: true, group: false })

  // 2. Paramètres financiers de base (random)
  const salary = rand(1500, 4500)
  const piggy = rand(0, 500)
  const bank = rand(500, 3500)

  await setProfileSalary(USER_A_ID, salary)
  await setPiggy({ profile_id: USER_A_ID }, piggy)
  await setBank({ profile_id: USER_A_ID }, bank)

  // 3. 3-6 budgets random avec économies pré-existantes occasionnelles
  const nBudgets = rand(3, 6)
  const chosenBudgets = pickN(BUDGET_POOL, nBudgets).map((b) => ({
    name: b.name,
    estimated_amount: rand(b.min, b.max),
    // 50% chance d'économies pré-existantes 10-50€ — utile pour la cascade
    // savings du bilan négatif si le random produit un déficit.
    cumulated_savings: chance(0.5) ? rand(10, 50) : 0,
  }))

  const budgetIds = await insertProfileBudgets(USER_A_ID, chosenBudgets)

  // 4. 1-3 dépenses par budget. Le facteur 0.4-1.3 sur l'estimated donne un
  //    mix surplus/déficit que tu pourras tester selon le random tiré.
  const expenses = []
  for (const b of chosenBudgets) {
    const nExp = rand(1, 3)
    const totalToSpend = Math.max(0, Math.round(b.estimated_amount * randFactor(0.4, 1.3)))
    const descPool = EXPENSE_DESCRIPTIONS[b.name] ?? ['Achat']
    // Distribution équilibrée avec un jitter ±40 %, last split absorbe les centimes
    const splits = []
    let remaining = totalToSpend
    for (let i = 0; i < nExp; i++) {
      if (i === nExp - 1) {
        splits.push(remaining)
        break
      }
      const baseShare = Math.round(totalToSpend / nExp)
      const jittered = Math.max(5, Math.round(baseShare * randFactor(0.6, 1.4)))
      const capped = Math.min(jittered, remaining - (nExp - i - 1) * 5)
      splits.push(Math.max(5, capped))
      remaining -= splits[i]
    }
    for (let i = 0; i < nExp; i++) {
      if (splits[i] <= 0) continue
      expenses.push({
        budget_name: b.name,
        amount: splits[i],
        description: descPool[i % descPool.length],
        // 85 % validées (applied) / 15 % non validées (apparaîtront en carry-over potentiel)
        applied: chance(0.85),
      })
    }
  }

  await insertProfileExpenses(USER_A_ID, budgetIds, expenses)

  // 5. 0-2 revenus exceptionnels avec 30 % de chance
  const realIncomes = []
  if (chance(0.3)) {
    const nIncomes = rand(1, 2)
    for (let i = 0; i < nIncomes; i++) {
      realIncomes.push({
        amount: rand(50, 300),
        description: pickOne(INCOME_DESCRIPTIONS),
        is_exceptional: true,
        applied: chance(0.8),
      })
    }
    await insertProfileRealIncomes(USER_A_ID, realIncomes)
  }

  // 6. Résumé pour la console
  const totalEstimated = chosenBudgets.reduce((s, b) => s + b.estimated_amount, 0)
  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0)
  const totalRealIncomes = realIncomes.reduce((s, ri) => s + ri.amount, 0)
  const surplus = totalEstimated - totalSpent
  const sign = surplus > 0 ? `positif (~+${surplus}€)` : surplus < 0 ? `négatif (~${surplus}€)` : 'équilibré'

  printPostSeedInstructions({
    scenarioKey: 'random-profile',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      `Wizard à démarrer depuis l'écran "Bienvenue". Tendance bilan : ${sign}. ` +
      `Re-lance le script pour générer un nouveau tirage aléatoire.`,
    expectedFigures: {
      Salaire: salary,
      'Tirelire avant': piggy,
      'Solde bancaire': bank,
      'Nb budgets': nBudgets,
      Budgets: chosenBudgets
        .map((b) => `${b.name} ${b.estimated_amount}€${b.cumulated_savings ? ` (+${b.cumulated_savings}€ éco)` : ''}`)
        .join(', '),
      'Total estimé': totalEstimated,
      'Total dépensé': totalSpent,
      'Revenus exceptionnels': totalRealIncomes,
      'Surplus brut (estimé - dépensé)': surplus,
    },
    cookieHint: true,
  })
})
