# Debug Monthly Recap - Étape par étape

## 🎯 Objectif
Comprendre pourquoi le déficit de 50€ n'est pas reporté dans le carryover.

## 📋 Étapes de debug

### 1. Vérifier les logs du serveur
**Quand vous faites le monthly recap, regardez les logs du serveur Next.js.**

Vous devriez voir ces messages :
```
🔄 [Deficit Carryover] Début du traitement des déficits pour profile:xxx
✅ [Deficit Carryover] Utilisation forcée du système carryover complet
🔄 [Deficit Carryover] X budget(s) trouvé(s), calcul des déficits...
📊 [Deficit Carryover] "course": 200€ estimé, 250€ total dépensé (250€ + 0€ carryover) = 50€ déficit
🔄 [Deficit Carryover] 1 budget(s) avec déficit détecté(s)
```

### 2. Vérifier l'état AVANT monthly recap
Exécutez dans Supabase :
```sql
SELECT
  id, name, estimated_amount,
  carryover_spent_amount, carryover_applied_date,
  monthly_surplus, monthly_deficit,
  updated_at
FROM estimated_budgets
WHERE name = 'course';
```

### 3. Vérifier les dépenses sur ce budget
```sql
SELECT
  id, amount, description, expense_date, created_at
FROM real_expenses
WHERE estimated_budget_id = '7177e3a6-14b8-46f4-adf7-6a8ca833bc94'
ORDER BY expense_date DESC;
```

### 4. Vérifier l'état APRÈS monthly recap
Re-exécuter la requête du point 2 pour voir si `carryover_spent_amount` a changé.

## 🔍 Points à vérifier

1. **Y a-t-il vraiment une dépense de 250€** sur le budget "course" ?
2. **Les logs montrent-ils le calcul correct** du déficit ?
3. **L'UPDATE SQL s'exécute-t-il** sans erreur ?
4. **Le `updated_at` change-t-il** après le monthly recap ?

## 🚨 Problèmes possibles

1. **Pas de dépenses** : Vous n'avez pas ajouté de dépenses de 250€
2. **Mauvais budget_id** : Les dépenses ne sont pas liées au bon budget
3. **Erreur SQL** : L'UPDATE échoue silencieusement
4. **Cache** : Le frontend affiche des données mises en cache
5. **API pas redémarrée** : Les changements de code ne sont pas pris en compte