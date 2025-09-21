/**
 * Script de test pour déboguer l'API dashboard et vérifier le carryover
 *
 * Ajoutez ce code temporairement dans votre API dashboard pour déboguer
 */

// Code à ajouter temporairement dans app/api/finances/dashboard/route.ts
// après la ligne qui calcule budgetsWithSpending

console.log('🔍 [DEBUG Dashboard] Budgets avec carryover:', budgetsWithSpending.map(budget => ({
  name: budget.name,
  estimated_amount: budget.estimated_amount,
  spent_this_month: budget.spent_this_month,
  carryover_spent_amount: budget.carryover_spent_amount,
  monthly_surplus: budget.monthly_surplus,
  raw_budget_data: {
    carryover_spent_amount: budget.carryover_spent_amount,
    monthly_surplus: budget.monthly_surplus
  }
})));

// Ou bien, testez directement l'API avec curl/Postman
// GET /api/finances/dashboard
// Avec les cookies de session appropriés

console.log('Test terminé - vérifiez les logs de l\'API dashboard');