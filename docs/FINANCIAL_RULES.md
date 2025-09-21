# Règles de Calcul Financier

## Vue d'ensemble

Ce document détaille les règles de calcul financier selon le battleplan.txt et les spécifications métier.

## 🏗️ Architecture des Données

### Pour chaque Profile et Group :
- **Cash disponible** (argent réel sur le compte)
- **Reste à vivre** (budget disponible pour le mois)
- **Budgets estimés** (catégories de dépenses planifiées)
- **Revenus estimés** (entrées d'argent prévues)
- **Revenus réels** (argent effectivement reçu)
- **Dépenses réelles** (argent effectivement dépensé)

## 💰 Règles de Calcul

### 1. Cash Disponible
**Définition** : L'argent réellement disponible sur le compte bancaire à un instant T

**Formule** :
```
Cash Disponible = Revenus Réels - Dépenses Réelles
```

**Caractéristiques** :
- ✅ Peut être négatif (découvert)
- ✅ Basé uniquement sur les entrées/sorties réelles d'argent
- ✅ Mis à jour à chaque transaction réelle

### 2. Reste à Vivre

#### 📱 Pour les Profiles (utilisateurs individuels)
**Définition** : L'argent disponible pour le mois après avoir soustrait les budgets et ajouté les revenus

**Formule CORRIGÉE (2025-09-21)** :
```
Reste à Vivre = Revenus Estimés Non Utilisés + Revenus Réels Reçus
                - Budgets Estimés - Dépenses Exceptionnelles + Économies des Budgets
```

**Logique des Revenus Estimés** :
- **Non utilisé** (0€ reçu) : +montant estimé complet
- **Utilisé** : +montant réellement reçu (remplace l'estimation)

#### 👥 Pour les Groups
**Définition** : Budget collectif disponible incluant les contributions des membres

**Formule CORRIGÉE (2025-09-21)** :
```
Reste à Vivre = Revenus Estimés Non Utilisés + Revenus Réels Reçus + Contributions des Profiles
                - Budgets Estimés - Dépenses Exceptionnelles + Économies des Budgets
```

**Caractéristiques** :
- ✅ Peut être négatif (budget dépassé)
- ✅ Inclut les économies des budgets précédents
- ✅ Recalculé en temps réel lors des modifications de planification

### 3. Budgets Estimés
**Définition** : Catégories de dépenses planifiées pour le mois

**Exemples** :
- "Budget courses : 500€"
- "Budget activité sportive : 200€"

**Fonctionnalités** :
- ✅ Création, modification, suppression
- ✅ Nom et montant personnalisables
- ✅ Économies associées (voir section Économies)

### 4. Économies des Budgets

#### 🚨 RÈGLE CRITIQUE : Temporalité des Économies

**❌ ERREUR COMMUNE** : Calculer les économies en temps réel pendant le mois
**✅ RÈGLE CORRECTE** : Les économies ne sont calculées QU'À LA FIN de la période

#### Logique Temporelle :

##### 📅 **Pendant le mois (temps réel)** :
```
Économies = 0€ (toujours)
```
**Raison** : Le mois n'est pas terminé, impossible de savoir si le budget sera respecté

##### 📅 **À la fin du mois/période** :
```
Économies = MAX(0, Budget Estimé - Dépenses Réelles du Budget)
```

#### Exemple Concret :
```
📊 Budget "Courses" : 200€
📅 15 du mois :
   - Dépensé : 0€
   - Économies : 0€ ❌ PAS 200€ !

📅 Fin du mois :
   - Dépensé : 150€
   - Économies : 50€ ✅ (200€ - 150€)
```

### 5. Revenus et Dépenses

#### Revenus Réels
- Saisie manuelle à chaque réception d'argent
- Peuvent être liés à un "Revenu Estimé" ou être exceptionnels
- Impact immédiat sur le "Cash Disponible"

#### 🎯 Logique des Revenus Estimés (MISE À JOUR 2025-09-21)

**État : Non Utilisé (0€ reçu)**
- **Interface** : Affichage GRIS (vs rouge alarmant)
- **Calcul** : +montant estimé complet au reste à vivre
- **Exemple** : Salaire estimé 3000€ → +3000€ au reste à vivre

**État : Utilisé (revenus réels ajoutés)**
- **Interface** : Couleur selon pourcentage (rouge/jaune/vert)
- **Calcul** : +montant réellement reçu au reste à vivre
- **Exemple** : Salaire estimé 3000€, reçu 2900€ → +2900€ au reste à vivre

**Transitions**
- Non utilisé → Utilisé : Passage de +estimation à +réel
- Modification du réel : Mise à jour directe du montant
- Suppression du réel : Retour à l'état "Non utilisé"

#### Dépenses Réelles
- Saisie manuelle à chaque dépense
- Peuvent être liées à un "Budget Estimé" ou être exceptionnelles
- Impact immédiat sur le "Cash Disponible"
- Les dépenses exceptionnelles réduisent le "Reste à Vivre"

## 🔄 Cycle de Vie Financier

### Phase 1 : Planification (début de mois)
1. Créer/modifier les **Budgets Estimés**
2. Définir les **Revenus Estimés**
3. Le **Reste à Vivre** se calcule automatiquement

### Phase 2 : Suivi (pendant le mois)
1. Saisir les **Revenus Réels** → Met à jour le **Cash Disponible**
2. Saisir les **Dépenses Réelles** → Met à jour le **Cash Disponible**
3. Les **Économies restent à 0** (mois en cours)

### Phase 3 : Bilan (fin de mois)
1. Calculer les **vraies Économies** par budget
2. Reporter les **Économies** dans le calcul du **Reste à Vivre** du mois suivant
3. Réinitialiser pour le nouveau mois

## 🧮 Exemples de Calculs

### Exemple 1 : Utilisateur Individual (Profile)
```
📊 Données :
- Revenus Estimés : 2000€
- Budgets Estimés : 200€ (Courses)
- Dépenses Exceptionnelles : 0€
- Économies : 0€ (mois en cours)

💡 Calcul Reste à Vivre :
2000€ - 200€ - 0€ + 0€ = 1800€ ✅
```

### Exemple 2 : Avec Économies (fin de mois précédent)
```
📊 Données :
- Revenus Estimés : 2000€
- Budgets Estimés : 200€
- Dépenses Exceptionnelles : 50€
- Économies : 100€ (du mois précédent)

💡 Calcul Reste à Vivre :
2000€ - 200€ - 50€ + 100€ = 1850€ ✅
```

## 📈 Intégration Technique

### Sauvegarde Automatique
- Chaque modification de planification déclenche un **snapshot** en base
- Table `remaining_to_live_snapshots` pour l'historique
- Raison de snapshot : `budget_created`, `income_updated`, etc.

### Cache et Performance
- Cache intelligent de 5 minutes sur les calculs
- Invalidation automatique lors des modifications
- Refresh automatique du dashboard après modifications

### APIs Concernées
- `/api/budgets` - CRUD des budgets avec sauvegarde automatique
- `/api/incomes` - CRUD des revenus avec sauvegarde automatique
- `/api/financial/dashboard` - Calculs en temps réel avec cache
- `/api/debug/financial` - Debug détaillé des calculs

## 🚨 Points d'Attention

1. **Économies ≠ Argent non dépensé** : Les économies ne se calculent qu'en fin de période
2. **Cache** : Toujours invalider après modifications de planification
3. **Battleplan** : Respecter strictement les règles définies
4. **Logs** : Tracer tous les calculs pour le debugging
5. **Validation** : Vérifier que `totalEstimatedIncome - totalEstimatedBudgets = Reste à Vivre` (sans économies en cours de mois)

## 🔄 Changements et Améliorations

### 2025-09-21 : Correction Logique Revenus Estimés

**Problème identifié** :
- Logique de "compensation" complexe et contre-intuitive
- Affichage rouge alarmant pour revenus non encore reçus

**Solution implémentée** :
- **Logique simple** : revenus non utilisés = +estimation, revenus utilisés = +réel
- **Affichage intuitif** : gris pour non utilisé, couleurs pour pourcentage une fois utilisé
- **Calculs prévisibles** : correspondent à l'attente utilisateur

**Fichiers modifiés** :
- `lib/financial-calculations.ts` : Fonctions `calculateIncomeCompensationProfile/Group`
- `components/dashboard/IncomeProgressIndicator.tsx` : Logique d'affichage couleur

---

*Documentation mise à jour le 2025-09-21 - Correction majeure de la logique des revenus estimés*