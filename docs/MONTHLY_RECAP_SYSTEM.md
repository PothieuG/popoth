# Monthly Recap System

## Vue d'ensemble

Le système de Monthly Recap permet aux utilisateurs de finaliser leur mois financier en gérant les déficits, surplus et économies de leurs budgets estimés. C'est un processus en 3 étapes qui assure une transition propre entre les mois.

## Principe général

### Philosophie simplifiée
- **Déficits** : Sont ajoutés comme dépenses réelles au mois suivant (affichage "50€/200€")
- **Surplus** : Sont ajoutés aux économies cumulées du budget
- **Budget estimé** : Reste toujours inchangé
- **Pas de système complexe** : Plus de carryover ou de colonnes dédiées

## Architecture du système

### Composants principaux

1. **`useMonthlyRecap`** (`hooks/useMonthlyRecap.ts`)
   - Hook principal pour la gestion du récapitulatif
   - Gère les 3 étapes et la navigation
   - Types : `RecapData`, `BudgetStat`, `RemainingToLiveChoice`

2. **API Routes**
   - `/api/monthly-recap/status` - Vérifie si un récap est requis
   - `/api/monthly-recap/initialize` - Démarre le processus (étape 1)
   - `/api/monthly-recap/complete` - Finalise le récap (étape 3)

3. **Composants UI**
   - `MonthlyRecapStep1.tsx` - Gestion du reste à vivre
   - `MonthlyRecapStep2.tsx` - Affichage des économies/déficits
   - `MonthlyRecapStep3.tsx` - Confirmation finale

## Processus en 3 étapes

### Étape 1 : Gestion du reste à vivre
**Composant** : `MonthlyRecapStep1.tsx`

**Objectif** : Décider que faire du reste à vivre (positif ou négatif)

**Options** :
- **Reste à vivre positif** : Reporter au mois suivant
- **Reste à vivre négatif** : Choisir un budget avec surplus pour compenser

**API** : `POST /api/monthly-recap/initialize`
- Crée un snapshot de sécurité
- Calcule les surplus/déficits de chaque budget
- Retourne les données pour l'étape 1

### Étape 2 : Affichage des économies/déficits
**Composant** : `MonthlyRecapStep2.tsx`

**Objectif** : Voir le détail des budgets et leurs économies existantes

**Affichage pour chaque budget** :
```
Budget A
Budgété: 200€
Dépensé: 150€
+50€ d'économie
+ 75€ d'économies déjà présentes  ← En violet si > 0
```

**Fonctionnalités** :
- Transferts manuels entre budgets (fonctionnalité future)
- Auto-répartition des excédents (fonctionnalité future)
- Ratio général des budgets

### Étape 3 : Finalisation
**Composant** : `MonthlyRecapStep3.tsx`

**Objectif** : Confirmer et appliquer les changements

**API** : `POST /api/monthly-recap/complete`
- Applique la logique de déficits/surplus
- Supprime les revenus et dépenses réels
- Reporte les déficits comme nouvelles dépenses
- Cumule les surplus dans les économies

## Logique de traitement

### Traitement des déficits
```javascript
// Si déficit > 0
const deficit = Math.max(0, realExpenses - estimatedAmount)

// Créer une dépense réelle pour le déficit
const deficitExpense = {
  estimated_budget_id: budget.id,
  amount: deficit,
  description: `Déficit reporté du récap ${month}/${year}`,
  expense_date: currentDate
}
```

**Résultat** : Budget 200€ → Dépense 50€ → Affichage "50€/200€"

### Traitement des surplus
```javascript
// Si surplus > 0
const surplus = Math.max(0, estimatedAmount - realExpenses)

// Ajouter aux économies cumulées
const newSavingsAmount = (currentSavings || 0) + surplus
```

**Résultat** : 75€ économies existantes + 50€ surplus = 125€ économies totales

## Intégration avec le dashboard

### Affichage des économies
**Composant** : `BudgetProgressIndicator.tsx`
- Utilise `useBudgetProgress` qui récupère `cumulated_savings`
- Affiche les économies sous chaque budget dans la planification

### Types de données
```typescript
interface BudgetStat {
  id: string
  name: string
  estimated_amount: number
  spent_amount: number
  difference: number
  surplus: number
  deficit: number
  cumulated_savings?: number // Économies cumulées existantes
}
```

## Configuration et statut

### Vérification automatique
Le système vérifie automatiquement si un récap est requis :
- Premier jour du mois
- Pas de récap existant pour le mois précédent
- Présence de données financières

### Sécurité
- **Snapshot system** : Sauvegarde complète avant traitement
- **Validation des données** : Vérification de cohérence
- **Transactions atomiques** : Tout réussit ou tout échoue

## Cas d'usage

### Exemple complet
**Situation initiale** :
- Budget Alimentation : 200€ estimé, 150€ dépensé, 30€ économies existantes
- Budget Transport : 100€ estimé, 120€ dépensé

**Après récap** :
- Budget Alimentation : 200€ estimé, 0€ dépensé, 80€ économies (30+50)
- Budget Transport : 100€ estimé, 20€ dépensé (déficit reporté), 30€ économies

**Affichage dashboard** :
- Alimentation : 0€/200€ + "80€ d'économies"
- Transport : 20€/100€ + "30€ d'économies"

## Maintenance et évolution

### Nettoyage effectué
- Suppression de l'ancien système carryover complexe
- Simplification des calculs
- Suppression des colonnes `carryover_spent_amount` (legacy)

### Améliorations futures possibles
- Transferts entre budgets dans l'étape 2
- Auto-répartition des excédents
- Historique des récaps mensuels
- Notifications de récap requis

## Fichiers de référence

- **Documentation** : `docs/MONTHLY_RECAP_SYSTEM.md` (ce fichier)
- **Hook principal** : `hooks/useMonthlyRecap.ts`
- **APIs** : `app/api/monthly-recap/`
- **Composants** : `components/monthly-recap/`
- **Tests** : Voir logs de développement dans `logs/`