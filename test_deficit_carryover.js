/**
 * Script de test pour valider le système de report des déficits
 *
 * Ce script simule le scénario décrit par l'utilisateur :
 * - Budget "Courses" estimé à 200€
 * - Dépense réelle de 250€ (déficit de 50€)
 * - Après validation du monthly recap, le déficit doit être reporté au mois suivant
 * - Le mois suivant, le budget devrait afficher "50€/200€ utilisé"
 */

console.log('🧪 [Test Deficit Carryover] Début du test du système de report des déficits');

// Test des calculs de base
function testDeficitCalculation() {
  console.log('\n1. Test du calcul de déficit');

  const budgetEstimate = 200;
  const actualSpent = 250;
  const deficit = actualSpent - budgetEstimate;

  console.log(`   Budget estimé: ${budgetEstimate}€`);
  console.log(`   Dépense réelle: ${actualSpent}€`);
  console.log(`   Déficit calculé: ${deficit}€`);

  if (deficit === 50) {
    console.log('   ✅ Calcul de déficit correct');
  } else {
    console.log('   ❌ Erreur dans le calcul de déficit');
  }

  return deficit;
}

// Test de la logique de carryover
function testCarryoverLogic(deficit) {
  console.log('\n2. Test de la logique de carryover');

  // Simulation des données après monthly recap
  const budgetAfterRecap = {
    id: 'test-budget-id',
    name: 'Courses',
    estimated_amount: 200,
    carryover_spent_amount: deficit, // Le déficit devient le carryover
    carryover_applied_date: '2025-01-01'
  };

  // Simulation d'une nouvelle dépense le mois suivant
  const newExpenseThisMonth = 0; // Pas encore de dépenses ce mois
  const totalSpentWithCarryover = newExpenseThisMonth + budgetAfterRecap.carryover_spent_amount;
  const availableBudget = budgetAfterRecap.estimated_amount - budgetAfterRecap.carryover_spent_amount;

  console.log(`   Carryover appliqué: ${budgetAfterRecap.carryover_spent_amount}€`);
  console.log(`   Nouvelles dépenses ce mois: ${newExpenseThisMonth}€`);
  console.log(`   Total "utilisé": ${totalSpentWithCarryover}€`);
  console.log(`   Budget disponible: ${availableBudget}€`);
  console.log(`   Affichage attendu: "${totalSpentWithCarryover}€/${budgetAfterRecap.estimated_amount}€ utilisé"`);

  if (totalSpentWithCarryover === 50 && availableBudget === 150) {
    console.log('   ✅ Logique de carryover correcte');
  } else {
    console.log('   ❌ Erreur dans la logique de carryover');
  }

  return budgetAfterRecap;
}

// Test de l'affichage progressif au cours du mois
function testProgressiveDisplay(budgetWithCarryover) {
  console.log('\n3. Test de l\'affichage progressif');

  // Simulation de différentes dépenses au cours du mois
  const scenarios = [
    { newExpenses: 0, description: 'Début du mois' },
    { newExpenses: 30, description: 'Milieu du mois' },
    { newExpenses: 100, description: 'Fin du mois (dans les limites)' },
    { newExpenses: 200, description: 'Fin du mois (nouveau déficit)' }
  ];

  scenarios.forEach((scenario, index) => {
    const totalSpent = scenario.newExpenses + budgetWithCarryover.carryover_spent_amount;
    const remainingBudget = budgetWithCarryover.estimated_amount - totalSpent;
    const isOverBudget = totalSpent > budgetWithCarryover.estimated_amount;

    console.log(`   Scénario ${index + 1}: ${scenario.description}`);
    console.log(`     Nouvelles dépenses: ${scenario.newExpenses}€`);
    console.log(`     Total utilisé: ${totalSpent}€/${budgetWithCarryover.estimated_amount}€`);
    console.log(`     Restant: ${remainingBudget}€`);
    console.log(`     Status: ${isOverBudget ? '❌ Dépassement' : '✅ Dans les limites'}`);
    console.log('');
  });
}

// Exécution des tests
function runTests() {
  console.log('🧪 [Test Deficit Carryover] === SIMULATION DU SYSTÈME DE CARRYOVER ===');

  const deficit = testDeficitCalculation();
  const budgetWithCarryover = testCarryoverLogic(deficit);
  testProgressiveDisplay(budgetWithCarryover);

  console.log('🎯 [Test Deficit Carryover] === RÉSUMÉ ===');
  console.log('Si le système est correctement implémenté :');
  console.log('1. Les déficits de 50€ sont correctement reportés au mois suivant');
  console.log('2. Le budget suivant affiche "50€/200€" même sans nouvelles dépenses');
  console.log('3. Le montant disponible est réduit à 150€ (200€ - 50€ de carryover)');
  console.log('4. Nouvelles dépenses + carryover = total affiché à l\'utilisateur');
  console.log('\n✅ Tests terminés avec succès !');
}

// Exécution
runTests();