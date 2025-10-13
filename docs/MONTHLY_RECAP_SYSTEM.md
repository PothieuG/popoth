# Monthly Recap System

## Vue d'ensemble

Le système de Monthly Recap permet aux utilisateurs de finaliser leur mois financier en gérant les déficits, surplus et économies de leurs budgets estimés. C'est un processus en 2 étapes qui assure une transition propre entre les mois.

**Dernière mise à jour : 2025-01-13**

## Principe général

### Philosophie simplifiée
- **Déficits** : Sont ajoutés comme dépenses réelles au mois suivant (affichage "50€/200€")
- **Surplus** : Sont ajoutés aux économies cumulées du budget
- **Budget estimé** : Reste toujours inchangé
- **Pas de système complexe** : Plus de carryover ou de colonnes dédiées
- **Données en temps réel** : Calculs directs depuis les dépenses et transferts
- **Transferts entre budgets** : Système de compensation via `budget_transfers`
- **Sauvegarde simple** : Seule l'étape courante est retenue en cas de refresh

## Architecture du système

### Composants principaux

1. **`useMonthlyRecap`** (`hooks/useMonthlyRecap.ts`)
   - Hook principal pour la gestion du récapitulatif
   - Gère les 2 étapes et la navigation
   - Sauvegarde/restauration de l'étape courante via localStorage
   - Types : `RecapData`, `BudgetStat`, `RemainingToLiveChoice`

2. **API Routes - Données**
   - `/api/monthly-recap/step1-data` - Données pour l'étape 1 (reste à vivre)
   - `/api/monthly-recap/step2-data` - Données pour l'étape 2 (budgets avec transferts)
   - `/api/monthly-recap/complete` - Finalise le récap

3. **API Routes - Actions**
   - `/api/monthly-recap/balance` - Équilibrage automatique du reste à vivre
   - `/api/monthly-recap/transfer` - Transfert manuel entre budgets
   - `/api/monthly-recap/auto-balance` - Répartition proportionnelle automatique

4. **Composants UI**
   - `MonthlyRecapFlow.tsx` - Orchestrateur principal du flux
   - `MonthlyRecapStep1.tsx` - Gestion du reste à vivre
   - `MonthlyRecapStep2.tsx` - Gestion des économies/déficits et transferts

## Processus en 2 étapes

### Étape 1 : Gestion du reste à vivre
**Composant** : `MonthlyRecapStep1.tsx`

**Objectif** : Équilibrer le reste à vivre si négatif

**API** : `GET /api/monthly-recap/step1-data`
- Récupère les données financières en temps réel
- Calcule le reste à vivre actuel
- Identifie les budgets avec surplus et économies disponibles
- Retourne les possibilités d'équilibrage

**Comportements** :
- **Reste à vivre positif/nul** :
  - Affichage du montant qui sera reporté automatiquement
  - Bouton "Continuer" directement disponible

- **Reste à vivre négatif** :
  - Liste des budgets avec surplus/économies disponibles
  - Bouton "Équilibrer automatiquement" si fonds disponibles
  - Répartition proportionnelle depuis économies puis surplus
  - Si pas assez de fonds : possibilité de continuer avec le déficit

**API Action** : `POST /api/monthly-recap/balance`
- Calcule la répartition optimale pour équilibrer le RAV
- Utilise en priorité les économies cumulées
- Puis les surplus du mois si nécessaire
- Enregistre les transferts dans `budget_transfers`

### Étape 2 : Gestion des économies et déficits
**Composant** : `MonthlyRecapStep2.tsx`

**Objectif** : Gérer les surplus et déficits entre budgets

**API** : `GET /api/monthly-recap/step2-data`
- Récupère tous les budgets avec leurs statistiques
- Calcule les surplus/déficits en temps réel
- **Prend en compte les transferts existants**
- Affiche le ratio général des budgets

**Affichage pour chaque budget** :
```
Budget A
Budgété: 200€
Dépensé: 150€ (incluant transferts)
+50€ d'économie
+ 75€ d'économies cumulées  ← En violet si > 0
```

**Fonctionnalités** :

#### 1. Transferts manuels
**API** : `POST /api/monthly-recap/transfer`
- Permet de transférer des fonds d'un budget surplus vers un budget déficit
- Validation : le montant ne peut pas dépasser le surplus disponible
- Enregistre dans `budget_transfers` pour traçabilité
- Ajuste les calculs de surplus/déficit en temps réel

#### 2. Auto-répartition proportionnelle
**API** : `POST /api/monthly-recap/auto-balance`
- **Algorithme de répartition équitable** :
  - Chaque budget avec surplus contribue proportionnellement
  - Formule : `Contribution = (Surplus du budget / Surplus total) × Déficit à couvrir`
  - Tous les déficits sont traités simultanément
  - Répartition équitable et prévisible

**Exemple** :
```
Surplus : Budget A (+100€), Budget B (+50€) → Total: 150€
Déficits : Budget C (-90€), Budget D (-60€)

Répartition :
- Budget A (66.67%) → C: 60€, D: 40€
- Budget B (33.33%) → C: 30€, D: 20€

Résultat : Tous les déficits couverts proportionnellement
```

#### 3. Finalisation
**Bouton** : "Terminer le récapitulatif"
**API** : `POST /api/monthly-recap/complete`
- Applique la logique de déficits/surplus
- Reporte les déficits comme nouvelles dépenses
- Cumule les surplus dans les économies
- Marque le récap comme terminé

## Système de transferts entre budgets

### Table `budget_transfers`
Enregistre tous les transferts effectués pendant le monthly recap pour traçabilité et calculs en temps réel.

**Structure** :
```sql
budget_transfers (
  id UUID PRIMARY KEY,
  profile_id UUID REFERENCES profiles,
  group_id UUID REFERENCES groups,
  from_budget_id UUID REFERENCES estimated_budgets,
  to_budget_id UUID REFERENCES estimated_budgets,
  transfer_amount DECIMAL,
  transfer_reason TEXT,
  transfer_date DATE,
  monthly_recap_id UUID (nullable),
  created_at TIMESTAMP
)
```

### Calcul des surplus/déficits avec transferts

**Logique de calcul** :
```javascript
// 1. Calculer le montant dépensé réel
const spentAmount = sumOf(real_expenses where budget_id = budget.id)

// 2. Calculer les ajustements dus aux transferts
const transfersFrom = sumOf(budget_transfers where from_budget_id = budget.id)
const transfersTo = sumOf(budget_transfers where to_budget_id = budget.id)

// 3. Calculer le montant dépensé ajusté
const adjustedSpentAmount = spentAmount + transfersFrom - transfersTo

// 4. Calculer surplus/déficit
const difference = budget.estimated_amount - adjustedSpentAmount
const surplus = Math.max(0, difference)
const deficit = Math.max(0, -difference)
```

**Exemple concret** :
```
Budget Alimentation : 200€ estimé, 150€ dépensé
- Transfert de 30€ vers Budget Transport → spent ajusté = 180€
- Nouveau surplus = 20€ (au lieu de 50€)

Budget Transport : 100€ estimé, 120€ dépensé
- Reçoit 30€ depuis Budget Alimentation → spent ajusté = 90€
- Nouveau surplus = 10€ (au lieu d'un déficit de 20€)
```

## Logique de traitement final

### Traitement des déficits
```javascript
// Si déficit > 0 après tous les transferts
const deficit = Math.max(0, adjustedSpentAmount - estimatedAmount)

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
// Si surplus > 0 après tous les transferts
const surplus = Math.max(0, estimatedAmount - adjustedSpentAmount)

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
interface RecapData {
  session_id: string                    // Identifiant de session (remplace snapshot_id)
  current_remaining_to_live: number
  budget_stats: BudgetStat[]
  total_surplus: number
  total_deficit: number
  general_ratio: number
  context: 'profile' | 'group'
  month: number
  year: number
  user_name: string
}

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

### Continuité et fiabilité
- **Session tracking** : Suivi via `session_id` temporaire
- **Sauvegarde d'étape** : localStorage pour reprendre à la bonne page
- **Données temps réel** : Toujours les informations les plus récentes
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

### Mises à jour récentes (2025-01-13)

#### ✅ Système de transferts entre budgets
- **Ajout de la table `budget_transfers`** : Traçabilité complète de tous les mouvements
- **Calculs en temps réel** : Les surplus/déficits prennent en compte les transferts
- **APIs dédiées** :
  - `POST /api/monthly-recap/transfer` : Transfert manuel entre budgets
  - `POST /api/monthly-recap/auto-balance` : Répartition proportionnelle automatique

#### ✅ Algorithme d'auto-répartition amélioré
- **Ancien comportement** : Traitement séquentiel des déficits, risque d'épuisement des surplus
- **Nouveau comportement** :
  - Répartition proportionnelle simultanée sur tous les déficits
  - Chaque budget surplus contribue selon sa proportion du total
  - Distribution équitable et prévisible

#### ✅ Passage de 3 à 2 étapes
- **Suppression de l'étape 3** : Plus simple et plus direct
- **Finalisation directement depuis l'étape 2** : Bouton "Terminer le récapitulatif"

#### ✅ Interface utilisateur épurée
- **Suppression des références "live"** : Terminologie simplifiée
- **Indicateurs d'étapes corrects** : "Étape 1 sur 2" au lieu de "sur 3"

### Refactorisation 2025
- ✅ **Suppression complète du système de snapshots** : Plus de données figées
- ✅ **Migration vers session_id** : Identifiant temporaire au lieu de snapshot_id
- ✅ **Données temps réel** : Récupération directe depuis la base à chaque fois
- ✅ **Sauvegarde d'étape** : localStorage pour reprendre à la bonne page (24h max)
- ✅ **Simplification des API** : Moins de complexité, plus de réactivité

### Nettoyage historique
- Suppression de l'ancien système carryover complexe
- Simplification des calculs
- Suppression des colonnes `carryover_spent_amount` (legacy)

### Améliorations futures possibles
- Historique des récaps mensuels
- Notifications de récap requis
- Sauvegarde cloud de l'étape courante (au lieu de localStorage)
- Optimisation performance avec cache intelligent

## Système de sauvegarde d'étape

### Fonctionnement
Le système utilise `localStorage` pour sauvegarder l'étape courante :

```typescript
// Sauvegarde automatique à chaque changement d'étape
const stepData = {
  step: currentStep,
  sessionId: recapData.session_id,
  timestamp: Date.now(),
  context: 'profile' | 'group'
}
localStorage.setItem('monthly-recap-step', JSON.stringify(stepData))
```

### Restauration
- **Condition** : Même `session_id` + même `context` + < 24h
- **Au refresh** : Restauration automatique de l'étape
- **Nettoyage** : Suppression automatique à la fin ou si expiré

### Avantages
- ✅ Reprendre exactement où on en était après refresh/reconnexion
- ✅ Données toujours actuelles (pas de snapshots figés)
- ✅ Simple et performant
- ✅ Auto-nettoyage (24h max)

## Fichiers de référence

- **Documentation** : `docs/MONTHLY_RECAP_SYSTEM.md` (ce fichier)
- **Hook principal** : `hooks/useMonthlyRecap.ts`
- **APIs** : `app/api/monthly-recap/`
- **Composants** : `components/monthly-recap/`
- **Tests** : Voir logs de développement dans `logs/`