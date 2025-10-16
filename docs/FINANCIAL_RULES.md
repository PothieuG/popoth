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

**Formule CORRIGÉE (2025-10-15)** :
```
Reste à Vivre = Revenus Estimés Non Utilisés + Revenus Réels Reçus + Revenus Exceptionnels
                - Budgets Estimés - Dépenses Exceptionnelles - Déficits des Budgets
```
**⚠️ CHANGEMENT MAJEUR (2025-10-15)**: Les **déficits des budgets** sont maintenant **SOUSTRAITS** du reste à vivre

**Formule du Déficit d'un Budget** :
```
Déficit = MAX(0, Dépenses Réelles du Budget - Budget Estimé)
```

**Exemple** :
- Budget Transport : 300€
- Dépensé sur Transport : 450€
- **Déficit** : 150€ → Ces 150€ sont **soustraits** du reste à vivre

**Logique des Revenus Estimés** :
- **Non utilisé** (0€ reçu) : +montant estimé complet
- **Utilisé** : +montant réellement reçu (remplace l'estimation)

#### 👥 Pour les Groups
**Définition** : Budget collectif disponible incluant les contributions des membres

**Formule CORRIGÉE (2025-10-15)** :
```
Reste à Vivre = Revenus Estimés Non Utilisés + Revenus Réels Reçus + Revenus Exceptionnels + Contributions des Profiles
                - Budgets Estimés - Dépenses Exceptionnelles - Déficits des Budgets
```
**⚠️ CHANGEMENT MAJEUR (2025-10-15)**: Les **déficits des budgets** sont maintenant **SOUSTRAITS** du reste à vivre

**Formule du Déficit d'un Budget** :
```
Déficit = MAX(0, Dépenses Réelles du Budget - Budget Estimé)
```

**Caractéristiques** :
- ✅ Peut être négatif (budget dépassé)
- ❌ N'inclut PLUS les économies des budgets (supprimé 2025-09-23)
- ✅ Les déficits des budgets sont soustraits (ajouté 2025-10-15)
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

### 2025-10-15 : Ajout des Déficits de Budgets au Calcul du RAV

**Besoin identifié** :
- Lorsqu'un budget est dépassé, le dépassement devrait réduire le reste à vivre
- Exemple : Budget transport 300€, dépensé 450€ → déficit de 150€ à soustraire du RAV

**Solution implémentée** :
- **Nouvelle fonction** : `calculateBudgetDeficit()` pour calculer les dépassements
- **Formule du déficit** : `MAX(0, Dépenses Réelles - Budget Estimé)`
- **Intégration au RAV** : Les déficits sont maintenant soustraits du reste à vivre
- **Application** : Pour les profiles ET les groups

**Fichiers modifiés** :
- `lib/financial-calculations.ts` :
  - Ajout de `calculateBudgetDeficit()`
  - Modification de `calculateRemainingToLiveProfile()` (nouveau paramètre `budgetDeficits`)
  - Modification de `calculateRemainingToLiveGroup()` (nouveau paramètre `budgetDeficits`)
  - Modification de `getProfileFinancialData()` (calcul et passage des déficits)
  - Modification de `getGroupFinancialData()` (calcul et passage des déficits)
- `docs/FINANCIAL_RULES.md` : Mise à jour des formules et ajout d'exemples

## 🐷 Système de Tirelire et Équilibrage (Monthly Recap)

### Vue d'ensemble

Le système de tirelire permet d'accumuler des surplus budgétaires et de les utiliser lors du récapitulatif mensuel pour équilibrer le reste à vivre.

### Fonctionnement de la Tirelire

**Table** : `piggy_bank`
- **Propriété XOR** : Chaque tirelire appartient soit à un profile soit à un group
- **Montant** : `amount` (≥ 0, par défaut 0€)
- **Mise à jour** : `last_updated` timestamp

**Alimentation de la Tirelire** :
- Lors du monthly recap, si le reste à vivre **dépasse** l'objectif budgétaire
- Le surplus est automatiquement transféré dans la tirelire
- Accumulation progressive des excédents mensuels

### 🎯 Logique d'Équilibrage - Ordre de Priorité

Lorsque le reste à vivre est **inférieur** à l'objectif budgétaire (RAV budgétaire), l'équilibrage automatique utilise les ressources dans cet ordre :

#### Phase 1 : Tirelire 🐷
```
Montant utilisé = MIN(déficit à combler, montant tirelire)
```
- **Priorité** : PREMIÈRE ressource utilisée
- **Mode** : Montant complet si nécessaire
- **Effet** : Réduit directement le montant de la tirelire
- **Exemple** : Déficit 500€, Tirelire 300€ → Utilise 300€ de la tirelire

#### Phase 2 : Économies 💎
```
Pour chaque budget avec économies :
  Montant utilisé = (économies du budget / total économies) × montant restant à combler
```
- **Priorité** : DEUXIÈME ressource utilisée (après tirelire)
- **Mode** : Distribution **PROPORTIONNELLE** entre tous les budgets
- **Source** : Champ `cumulated_savings` des budgets estimés
- **Effet** : Réduit les économies accumulées de chaque budget
- **Exemple** :
  - Reste à combler : 200€
  - Budget A : 60€ économies (60% du total)
  - Budget B : 40€ économies (40% du total)
  - → Budget A perd 120€, Budget B perd 80€

#### Phase 3 : Surplus 📈
```
Pour chaque budget avec surplus :
  Montant utilisé = (surplus du budget / total surplus) × montant restant à combler
```
- **Priorité** : TROISIÈME ressource utilisée (en dernier)
- **Mode** : Distribution **PROPORTIONNELLE** entre tous les budgets
- **Calcul** : `MAX(0, Budget Estimé - Dépenses Réelles)`
- **Effet** : ⚠️ **NOTE** - Les surplus ne peuvent pas être consommés directement car ils font déjà partie du RAV budgétaire

### Exemple Complet d'Équilibrage

```
📊 Situation initiale :
- RAV actuel : 200€
- RAV budgétaire (objectif) : 800€
- Déficit à combler : 600€

💰 Ressources disponibles :
- Tirelire : 250€
- Économies Budget A : 180€ (60%)
- Économies Budget B : 120€ (40%)
- Surplus Budget C : 200€

🔄 Équilibrage automatique :

Phase 1 - Tirelire :
  ✅ Utilise 250€ de la tirelire
  → Reste à combler : 350€
  → Nouvelle tirelire : 0€

Phase 2 - Économies (proportionnel) :
  ✅ Budget A : 180€ × (300€ / 300€) = 180€
  ✅ Budget B : 120€ × (300€ / 300€) = 120€
  → Total utilisé : 300€
  → Reste à combler : 50€
  → Économies restantes : A=0€, B=0€

Phase 3 - Surplus (proportionnel) :
  ✅ Budget C : 50€ utilisés
  → Reste à combler : 0€

✅ Résultat final :
  - RAV final : 800€ (objectif atteint)
  - Tirelire : 0€
  - Économies : 0€
  - Déficit résolu : 600€
```

### APIs Impliquées

- **`/api/monthly-recap/step1-data`** : Récupère les données incluant la tirelire
- **`/api/monthly-recap/balance`** : Effectue l'équilibrage automatique
  - Récupère le montant de la tirelire
  - Applique les 3 phases d'équilibrage
  - Met à jour la tirelire (`last_updated`)
  - Met à jour les économies des budgets (`cumulated_savings`)

### Règles Importantes

1. ⚠️ **La tirelire n'est JAMAIS répartie** - Elle est utilisée uniquement pour l'équilibrage
2. ✅ **L'ordre est strict** : Tirelire → Économies → Surplus
3. 💡 **Distribution proportionnelle** : Les économies et surplus sont prélevés proportionnellement
4. 🔒 **Équilibrage partiel possible** : Si les ressources sont insuffisantes, équilibrage jusqu'au maximum possible
5. 📊 **Transparence** : L'interface montre clairement ce qui restera après équilibrage

---

*Documentation mise à jour le 2025-10-16 - Ajout du système de tirelire et d'équilibrage*