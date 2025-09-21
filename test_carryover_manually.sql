-- Test manuel du système de carryover
-- Exécutez ces commandes une par une pour tester

-- 1. SETUP: Créer un budget de test avec déficit simulé
INSERT INTO estimated_budgets (
  profile_id,
  name,
  estimated_amount,
  monthly_deficit,
  carryover_spent_amount
) VALUES (
  (SELECT id FROM profiles LIMIT 1), -- Remplacez par votre profile_id
  'Test Carryover',
  200,
  50, -- Déficit de 50€
  0   -- Pas encore de carryover
);

-- 2. Récupérer l'ID du budget créé pour les tests suivants
SELECT id, name, estimated_amount, monthly_deficit, carryover_spent_amount
FROM estimated_budgets
WHERE name = 'Test Carryover';

-- 3. SIMULATION: Appliquer le carryover comme le ferait l'API
UPDATE estimated_budgets
SET
  carryover_spent_amount = monthly_deficit,
  carryover_applied_date = CURRENT_DATE,
  monthly_deficit = 0,
  updated_at = NOW()
WHERE name = 'Test Carryover';

-- 4. VÉRIFIER: Le budget doit maintenant avoir carryover_spent_amount = 50
SELECT
  id,
  name,
  estimated_amount,
  monthly_deficit,
  carryover_spent_amount,
  carryover_applied_date
FROM estimated_budgets
WHERE name = 'Test Carryover';

-- 5. TEST: Simuler ce que l'API /finances/dashboard devrait calculer
-- Cela devrait retourner spent_this_month = 50 (0 + 50 de carryover)
WITH budget_test AS (
  SELECT
    id,
    name,
    estimated_amount,
    carryover_spent_amount,
    COALESCE(carryover_spent_amount, 0) as carryover_spent,
    -- Simulation: 0 dépenses réelles ce mois + carryover
    0 + COALESCE(carryover_spent_amount, 0) as total_spent_this_month
  FROM estimated_budgets
  WHERE name = 'Test Carryover'
)
SELECT
  name,
  estimated_amount,
  total_spent_this_month,
  CONCAT(total_spent_this_month, '€/', estimated_amount, '€') as display_format
FROM budget_test;

-- 6. CLEANUP: Supprimer le budget de test (optionnel)
-- DELETE FROM estimated_budgets WHERE name = 'Test Carryover';