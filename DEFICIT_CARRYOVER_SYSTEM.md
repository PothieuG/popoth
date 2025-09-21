# Système de Report des Déficits (Deficit Carryover System)

## 📋 Objectif

Implémenter un système qui reporte automatiquement les déficits budgétaires non compensés d'un mois vers le mois suivant.

**Exemple concret** :
- Budget "Courses" estimé à 200€ en janvier
- Dépenses réelles de 250€ en janvier → déficit de 50€
- En février, le budget affiche "50€/200€ utilisé" même sans nouvelles dépenses
- Budget disponible en février : 150€ (200€ - 50€ de carryover)

## 🏗️ Architecture

### Base de données

Nouvelles colonnes ajoutées à `estimated_budgets` :

```sql
-- Montant "déjà dépensé" reporté du mois précédent
carryover_spent_amount numeric DEFAULT 0 CHECK (carryover_spent_amount >= 0)

-- Date d'application du carryover (pour tracking)
carryover_applied_date date
```

### Logique de fonctionnement

1. **Fin de mois (API `/api/monthly-recap/complete`)** :
   - Budgets avec déficit → `monthly_deficit > 0`
   - Si déficit non compensé → Report vers `carryover_spent_amount`
   - Reset `monthly_deficit = 0`

2. **Calculs du mois suivant** :
   - Montant "utilisé" = `dépenses_réelles + carryover_spent_amount`
   - Montant disponible = `estimated_amount - carryover_spent_amount`

3. **Affichage utilisateur** :
   - Format : "{montant_utilisé}€/{budget_estimé}€ utilisé"
   - Exemple : "50€/200€ utilisé"

## 🔄 Migration depuis l'ancien système

### Avant (système temporaire)
- Déficits stockés comme `monthly_surplus` négatif
- Logique complexe de détection des surplus négatifs

### Après (nouveau système)
- Déficits stockés dans `carryover_spent_amount`
- Date de report trackée dans `carryover_applied_date`
- Logique claire et séparée

### Script de migration

Le script `database/implement_deficit_carryover.sql` :
1. Ajoute les nouvelles colonnes
2. Convertit automatiquement les surplus négatifs existants
3. Nettoie l'ancien système

## 📁 Fichiers modifiés

### APIs
- `app/api/monthly-recap/complete/route.ts` - Logique de report
- `app/api/finances/budgets/estimated/route.ts` - Calculs avec carryover
- `app/api/monthly-recap/initialize/route.ts` - Support du carryover

### Calculs
- `lib/financial-calculations.ts` - Intégration du carryover
- `hooks/useBudgets.ts` - Interface TypeScript
- `hooks/useBudgetProgress.ts` - Interface TypeScript

### Base de données
- `database/implement_deficit_carryover.sql` - Script principal
- Fonction `check_column_exists()` pour détection automatique

## 🧪 Tests et validation

### Scénario de test

```javascript
// Test du script test_deficit_carryover.js
Budget: 200€ estimé, 250€ dépensé = 50€ de déficit
Après monthly recap: carryover_spent_amount = 50€
Mois suivant: "50€/200€ utilisé" même sans nouvelles dépenses
```

### Points de validation

1. ✅ Déficit correctement calculé (250€ - 200€ = 50€)
2. ✅ Report automatique après monthly recap
3. ✅ Affichage correct le mois suivant ("50€/200€")
4. ✅ Budget disponible réduit (150€ = 200€ - 50€)
5. ✅ Nouvelles dépenses s'ajoutent au carryover

## 🚀 Déploiement

### Étapes

1. **Exécuter le script SQL** :
   ```sql
   -- Sur Supabase
   \i database/implement_deficit_carryover.sql
   ```

2. **Déployer le code** :
   - Les APIs détectent automatiquement les nouvelles colonnes
   - Fallback automatique sur l'ancien système si colonnes absentes

3. **Validation** :
   - Tester avec un budget en déficit
   - Valider le monthly recap
   - Vérifier l'affichage le mois suivant

### Compatibilité

- ✅ **Rétrocompatible** : Code fonctionne avec et sans nouvelles colonnes
- ✅ **Migration automatique** : Surplus négatifs convertis automatiquement
- ✅ **Fallback** : Ancien système utilisé si nouvelles colonnes absentes

## 📊 Monitoring

### Logs à surveiller

```
🔄 [Deficit Carryover] Utilisation du système carryover complet
✅ [Deficit Carryover] X déficit(s) reporté(s) avec succès
💡 [Deficit Carryover] Utilisation du système de fallback (surplus négatif)
```

### Requêtes utiles

```sql
-- Budgets avec carryover actif
SELECT name, estimated_amount, carryover_spent_amount, carryover_applied_date
FROM estimated_budgets
WHERE carryover_spent_amount > 0;

-- Migration des surplus négatifs
SELECT name, monthly_surplus
FROM estimated_budgets
WHERE monthly_surplus < 0;
```

## ✨ Avantages du nouveau système

1. **Clarté** : Colonnes dédiées vs surplus négatifs
2. **Traçabilité** : Date d'application du carryover
3. **Performance** : Calculs simplifiés
4. **Maintenabilité** : Code plus lisible
5. **Évolutivité** : Base solide pour futures fonctionnalités

---

*Système implémenté pour résoudre le problème de report des déficits dans Popoth_App_Claude*