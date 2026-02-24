# Monthly Recap - Spécification Technique

## Version: 1.0
## Auteur: Technical Specification
## Date: 2025-11-29

---

## Table des Matières

1. [Vue d'ensemble](#vue-densemble)
2. [Déclenchement](#déclenchement)
3. [Terminologie et Définitions](#terminologie-et-définitions)
4. [Écran Initial - Affichage des Données](#écran-initial---affichage-des-données)
5. [Algorithme de Rééquilibrage Automatique](#algorithme-de-rééquilibrage-automatique)
6. [Règles de Persistance des Données](#règles-de-persistance-des-données)
7. [Écran Récapitulatif Final](#écran-récapitulatif-final)
8. [Exemples Détaillés](#exemples-détaillés)
9. [Assertions et Invariants](#assertions-et-invariants)

---

## Vue d'ensemble

Le Monthly Recap est un processus de rééquilibrage budgétaire mensuel automatique qui garantit que l'utilisateur commence chaque nouveau mois avec des finances équilibrées. Il s'exécute une seule fois par mois, à la première connexion après le début d'un nouveau mois.

### Objectif Principal

Atteindre l'équilibre du **Reste à Vivre Budgétaire** (RAV Budgétaire = 0€) en utilisant les surplus, les économies et la tirelire, puis garantir la cohérence absolue entre l'état affiché et l'état en base de données.

---

## Déclenchement

### Condition de Déclenchement

Le Monthly Recap doit se déclencher à la **première connexion** de l'utilisateur après le changement de mois civil.

### Exemples

| Dernière Connexion | Connexion Actuelle | Déclenche Monthly Recap? |
|-------------------|-------------------|-------------------------|
| 28 Janvier 2025   | 1 Février 2025    | ✅ Oui                  |
| 28 Janvier 2025   | 15 Février 2025   | ✅ Oui                  |
| 15 Février 2025   | 20 Février 2025   | ❌ Non                  |
| 31 Mars 2025      | 1 Avril 2025      | ✅ Oui                  |

### Règle de Persistance

Une fois le Monthly Recap complété pour un mois donné, il ne doit **jamais** se redéclencher pour ce même mois, même si l'utilisateur se déconnecte et se reconnecte.

**Implémentation Suggérée**: Stocker en base de données une valeur `last_monthly_recap_date` (format: YYYY-MM) pour chaque utilisateur.

---

## Terminologie et Définitions

### 1. Reste à Vivre Budgétaire (RAV Budgétaire)

**Définition**: Le montant d'argent disponible que l'utilisateur devrait avoir après avoir budgété tous ses postes de dépenses estimés.

**Formule**:
```
RAV_Budgétaire = Σ(Argent_Disponible_Estimé) - Σ(Argent_Budgété_Estimé)
```

**Exclusions**:
- ❌ Ne prend PAS en compte les dépenses exceptionnelles
- ❌ Ne prend PAS en compte les revenus exceptionnels

**Exemple**:
```
Revenus Estimés Mensuels:
- Salaire: 2500€
- Freelance: 500€
Total Argent Disponible Estimé = 3000€

Budgets Estimés Mensuels:
- Loyer: 800€
- Alimentation: 400€
- Transport: 150€
- Loisirs: 200€
Total Argent Budgété Estimé = 1550€

RAV_Budgétaire = 3000€ - 1550€ = 1450€
```

### 2. Reste à Vivre Actuel (RAV Actuel)

**Définition**: Le montant d'argent réellement disponible sur les comptes de l'utilisateur au moment du lancement du Monthly Recap.

**Source**: Solde réel des comptes bancaires + argent liquide - dettes immédiates

### 3. Surplus

**Définition**: L'argent budgété mais non consommé durant le mois précédent pour un budget donné.

**Formule par Budget**:
```
Surplus_Budget_X = Budget_Estimé_X - Dépenses_Réelles_X
```

**Condition**: `Surplus_Budget_X ≥ 0` (si négatif, c'est un déficit)

**Exemple**:
```
Budget Alimentation Estimé: 400€
Dépenses Réelles Alimentation: 320€
Surplus Alimentation = 400€ - 320€ = 80€
```

### 4. Économies d'un Budget

**Définition**: Montant d'argent mis de côté spécifiquement pour un budget donné, accumulé sur plusieurs mois.

**Caractéristique**: Les économies sont attachées à un budget spécifique et peuvent être utilisées pour renflouer ce budget ou d'autres budgets en cas de besoin.

**Exemple**:
```
Budget Vacances:
- Économies accumulées: 300€
- Budget mensuel: 200€
- Dépenses réelles ce mois: 150€
- Nouveau Surplus: 50€
→ Après rééquilibrage: Économies = 300€ + 50€ = 350€
```

### 5. Tirelire

**Définition**: Réserve d'argent globale, non affectée à un budget spécifique, servant de filet de sécurité.

**Utilisation**:
- Premier recours pour renflouer les déficits budgétaires
- Réceptacle des revenus exceptionnels (argent qui n'est pas lié à un budget spécifique)

**Important**: La tirelire se remplit uniquement avec l'argent provenant de revenus exceptionnels, c'est-à-dire quand `RAV_Actuel > RAV_Budgétaire`. Les surplus de budgets vont toujours vers les économies de leurs budgets respectifs, jamais directement à la tirelire.

### 6. Budget Déficitaire

**Définition**: Un budget dont les dépenses réelles ont dépassé le montant budgété estimé.

**Formule**:
```
Déficit_Budget_X = Dépenses_Réelles_X - Budget_Estimé_X
```

**Condition**: Budget est déficitaire si `Déficit_Budget_X > 0`

**Exemple**:
```
Budget Transport Estimé: 150€
Dépenses Réelles Transport: 200€
Déficit Transport = 200€ - 150€ = 50€
→ Budget Transport est déficitaire de 50€
```

---

## Écran Initial - Affichage des Données

### Indicateurs Principaux

L'écran initial doit afficher les 5 indicateurs suivants:

#### 1. Reste à Vivre Budgétaire
```
Valeur: {RAV_Budgétaire}€
Calcul: Σ(Argent_Disponible_Estimé) - Σ(Argent_Budgété_Estimé)
```

#### 2. Reste à Vivre Actuel
```
Valeur: {RAV_Actuel}€
Source: Solde réel des comptes
```

#### 3. Surplus Total
```
Valeur: Σ(Tous les Surplus positifs)€
Calcul: Somme de tous les surplus > 0 de tous les budgets
```

#### 4. Économies Totales
```
Valeur: Σ(Économies de tous les budgets)€
Calcul: Somme des économies de tous les budgets
```

#### 5. Tirelire
```
Valeur: {Montant_Tirelire}€
Source: Valeur actuelle de la tirelire
```

### Statut d'Équilibre

Calculer et afficher si le RAV Budgétaire est atteint:

```
Différence = RAV_Actuel - RAV_Budgétaire
```

**Affichage**:

| Condition | Message | Style |
|-----------|---------|-------|
| Différence ≥ 0 | ✅ Équilibre atteint (+{Différence}€) | Vert/Succès |
| Différence < 0 | ⚠️ Rééquilibrage nécessaire ({Différence}€) | Orange/Alerte |

**Exemple 1 - Équilibre Atteint**:
```
RAV_Actuel = 1500€
RAV_Budgétaire = 1450€
Différence = 1500€ - 1450€ = +50€

Affichage: "✅ Équilibre atteint (+50€)"
Action: Surplus sera ajouté à la tirelire après traitement
```

**Exemple 2 - Rééquilibrage Nécessaire**:
```
RAV_Actuel = 1200€
RAV_Budgétaire = 1450€
Différence = 1200€ - 1450€ = -250€

Affichage: "⚠️ Rééquilibrage nécessaire (-250€)"
Action: Utiliser tirelire, économies, puis budgets pour combler
```

### Liste des Budgets avec Surplus/Économies

Afficher deux listes distinctes:

#### Liste A: Budgets avec Surplus
```
Budget | Montant Estimé | Dépensé | Surplus
-------|---------------|---------|--------
Alimentation | 400€ | 320€ | 80€
Loisirs | 200€ | 150€ | 50€
```

#### Liste B: Budgets avec Économies
```
Budget | Économies Actuelles
-------|-------------------
Vacances | 300€
Équipement | 150€
```

### Aperçu des Actions de Rééquilibrage

Afficher la liste des actions qui seront entreprises lors du rééquilibrage automatique:

**Exemple**:
```
Actions à entreprendre:
1. Transfert de 80€ du surplus Alimentation vers économies Alimentation
2. Transfert de 50€ du surplus Loisirs vers économies Loisirs
3. Renflouage de -50€ du budget Transport (déficitaire)
4. Utilisation de 50€ de la tirelire pour renflouer Transport
5. Transfert de 100€ des économies totales vers la tirelire
```

---

## Algorithme de Rééquilibrage Automatique

### Préambule Important

**CRITIQUE**: Toutes les modifications doivent être écrites **IMMÉDIATEMENT** en base de données. Aucun système de cache ou de buffer n'est autorisé.

### Cas 1: Différence ≥ 0 (Excédent ou Équilibre)

Quand `RAV_Actuel - RAV_Budgétaire ≥ 0`, il y a un excédent à gérer.

#### Étape 1.1: Transfert des Surplus vers Économies

**Pour chaque budget ayant un surplus > 0**:
```
Économies_Budget_X_Nouvelle = Économies_Budget_X_Actuelle + Surplus_Budget_X
Surplus_Budget_X_Nouveau = 0
```

**Action en Base de Données**:
```sql
UPDATE budgets
SET economies = economies + surplus,
    surplus = 0
WHERE budget_id = X AND surplus > 0
```

#### Étape 1.2: Calcul de l'Excédent Total et Transfert vers Tirelire

**Principe**: Quand `RAV_Actuel > RAV_Budgétaire`, cet excédent provient de revenus exceptionnels (car les revenus/budgets réguliers sont déjà comptabilisés dans le RAV_Budgétaire). Cet argent "en plus" doit aller à la tirelire.

**Calcul**:
```
Différence_RAV = RAV_Actuel - RAV_Budgétaire
Excédent_Pour_Tirelire = Différence_RAV
```

**Explication**: Les surplus de budgets ont déjà été transférés vers leurs économies respectives à l'Étape 1.1. La `Différence_RAV` représente donc uniquement l'argent exceptionnel qui doit aller à la tirelire.

**Condition**: `Excédent_Pour_Tirelire ≥ 0` (puisqu'on est dans le Cas 1 où Différence ≥ 0)

**Action en Base de Données**:
```sql
UPDATE tirelire
SET montant = montant + {Excédent_Pour_Tirelire}
WHERE {Excédent_Pour_Tirelire} > 0
```

#### Étape 1.3: Vérification des Budgets Déficitaires

**Identifier tous les budgets déficitaires**:
```
Déficit_Budget_X = Dépenses_Réelles_X - Budget_Estimé_X
```

Si `Déficit_Budget_X > 0`, le budget X est déficitaire.

#### Étape 1.4: Renflouage des Budgets Déficitaires

**Ordre de Priorité des Sources**:
1. **Tirelire** (en premier)
2. **Économies des budgets** (proportionnellement)

##### Étape 1.4.1: Utilisation de la Tirelire

**Pour chaque budget déficitaire** (par ordre de déficit décroissant ou alphabétique):

```
Montant_à_Renflouer = min(Déficit_Budget_X, Tirelire_Disponible)
Budget_X_Nouveau = Budget_X_Actuel + Montant_à_Renflouer
Tirelire_Nouvelle = Tirelire_Actuelle - Montant_à_Renflouer
Déficit_Budget_X_Restant = Déficit_Budget_X - Montant_à_Renflouer
```

**Action en Base de Données**:
```sql
-- Renflouer le budget
UPDATE budgets
SET montant_actuel = montant_actuel + {Montant_à_Renflouer}
WHERE budget_id = X;

-- Débiter la tirelire
UPDATE tirelire
SET montant = montant - {Montant_à_Renflouer}
```

##### Étape 1.4.2: Utilisation Proportionnelle des Économies

Si après utilisation de la tirelire, des déficits subsistent:

**Calcul de la Proportion pour Chaque Budget avec Économies**:
```
Total_Économies = Σ(Économies de tous les budgets avec économies > 0)

Pour chaque budget Y avec économies > 0:
    Proportion_Budget_Y = Économies_Budget_Y / Total_Économies
```

**Calcul du Montant à Prélever par Budget**:
```
Total_Déficit_Restant = Σ(Tous les déficits restants)

Pour chaque budget Y avec économies > 0:
    Prélèvement_Budget_Y = Total_Déficit_Restant × Proportion_Budget_Y
    Prélèvement_Budget_Y = min(Prélèvement_Budget_Y, Économies_Budget_Y)
```

**Action en Base de Données**:
```sql
-- Pour chaque budget avec économies
UPDATE budgets
SET economies = economies - {Prélèvement_Budget_Y}
WHERE budget_id = Y;

-- Redistribuer aux budgets déficitaires
UPDATE budgets
SET montant_actuel = montant_actuel + {Montant_Redistribué}
WHERE budget_id = X (déficitaire);
```

---

### Cas 2: Différence < 0 (Déficit)

Quand `RAV_Actuel - RAV_Budgétaire < 0`, il faut renflouer le RAV.

**Objectif**: Combler le gap de `|Différence|` euros pour atteindre l'équilibre.

#### Étape 2.1: Transfert des Surplus vers Économies

**Identique à l'Étape 1.1**:
```
Pour chaque budget avec surplus > 0:
    Économies_Budget_X_Nouvelle = Économies_Budget_X_Actuelle + Surplus_Budget_X
    Surplus_Budget_X_Nouveau = 0
```

**Action en Base de Données**:
```sql
UPDATE budgets
SET economies = economies + surplus,
    surplus = 0
WHERE surplus > 0
```

#### Étape 2.2: Utilisation de la Tirelire

**Calcul**:
```
Gap_à_Combler = |RAV_Actuel - RAV_Budgétaire|
Montant_Tirelire_Utilisable = min(Gap_à_Combler, Tirelire_Actuelle)
Gap_Restant = Gap_à_Combler - Montant_Tirelire_Utilisable
```

**Action en Base de Données**:
```sql
UPDATE tirelire
SET montant = montant - {Montant_Tirelire_Utilisable}
```

**Action de Renflouage**:
L'argent prélevé de la tirelire sert à augmenter le RAV Actuel. Cela peut se traduire par:
- Augmentation du solde d'un compte principal
- OU réduction d'un déficit global

#### Étape 2.3: Utilisation Proportionnelle des Économies

Si `Gap_Restant > 0`:

**Calcul de la Proportion**:
```
Total_Économies = Σ(Économies de tous les budgets)

Pour chaque budget X avec économies > 0:
    Proportion_Budget_X = Économies_Budget_X / Total_Économies
    Prélèvement_Budget_X = Gap_Restant × Proportion_Budget_X
    Prélèvement_Budget_X = min(Prélèvement_Budget_X, Économies_Budget_X)
```

**Action en Base de Données**:
```sql
UPDATE budgets
SET economies = economies - {Prélèvement_Budget_X}
WHERE budget_id = X
```

**Mise à jour du Gap**:
```
Gap_Restant = Gap_Restant - Σ(Tous les prélèvements)
```

#### Étape 2.4: Prélèvement Proportionnel dans les Budgets

Si `Gap_Restant > 0` après utilisation de la tirelire et des économies:

**Calcul de la Proportion par Budget**:
```
Total_Budgets_Disponibles = Σ(Montant_Actuel de tous les budgets avec montant > 0)

Pour chaque budget X avec montant_actuel > 0:
    Proportion_Budget_X = Montant_Actuel_Budget_X / Total_Budgets_Disponibles
    Prélèvement_Budget_X = Gap_Restant × Proportion_Budget_X
    Prélèvement_Budget_X = min(Prélèvement_Budget_X, Montant_Actuel_Budget_X)
```

**Exemple de Calcul**:
```
Gap_Restant = 50€

Budget Alimentation: 25€/100€ (25€ restant)
Budget Transport: 100€/200€ (100€ restant)
Total_Budgets_Disponibles = 25€ + 100€ = 125€

Proportion_Alimentation = 25€ / 125€ = 20%
Proportion_Transport = 100€ / 125€ = 80%

Prélèvement_Alimentation = 50€ × 20% = 10€
Prélèvement_Transport = 50€ × 80% = 40€

Nouveau Montant Alimentation = 25€ - 10€ = 15€
Nouveau Montant Transport = 100€ - 40€ = 60€
```

**Action en Base de Données**:
```sql
UPDATE budgets
SET montant_actuel = montant_actuel - {Prélèvement_Budget_X}
WHERE budget_id = X
```

#### Étape 2.5: Après Retour à l'Équilibre

Une fois que `Gap_Restant = 0` (équilibre atteint):

##### Étape 2.5.1: Si des surplus existent encore
```
Pour chaque budget avec surplus > 0:
    Économies_Budget_X += Surplus_Budget_X
    Surplus_Budget_X = 0
```

##### Étape 2.5.2: Transfert excédent vers tirelire (si applicable)
```
Différence_RAV_Nouvelle = RAV_Actuel_Nouveau - RAV_Budgétaire
Excédent_Pour_Tirelire = Différence_RAV_Nouvelle

Si Excédent_Pour_Tirelire > 0:
    Tirelire += Excédent_Pour_Tirelire
```

**Explication**: Si après avoir comblé le déficit, il reste un excédent (revenus exceptionnels), celui-ci va à la tirelire.

##### Étape 2.5.3: Renflouage des budgets déficitaires (si possible)

Appliquer les **Étapes 1.3 et 1.4** pour renflouer les budgets déficitaires s'il reste des ressources.

---

### Étape Finale: Nettoyage des Dépenses et Revenus Exceptionnels

**Action**: Supprimer toutes les dépenses et revenus marqués comme "exceptionnels" du mois précédent.

**Action en Base de Données**:
```sql
DELETE FROM depenses
WHERE type = 'exceptionnel'
AND date < DEBUT_MOIS_ACTUEL;

DELETE FROM revenus
WHERE type = 'exceptionnel'
AND date < DEBUT_MOIS_ACTUEL;
```

**Résultat**: Ces éléments ne doivent **jamais** apparaître dans les listes de dépenses/revenus du nouveau mois.

---

## Règles de Persistance des Données

### Règle Fondamentale

**TOUTES les modifications doivent être écrites en base de données IMMÉDIATEMENT lors de l'exécution de chaque étape.**

### Interdictions Strictes

❌ **Pas de cache en mémoire** des modifications
❌ **Pas de buffer ou file d'attente** de requêtes
❌ **Pas de commit différé** à la fin du processus
❌ **Pas de transaction suspendue** sur plusieurs écrans

### Exigence de Cohérence

✅ **Chaque UPDATE/DELETE doit être exécuté immédiatement**
✅ **L'état de la base doit refléter l'état affiché en temps réel**
✅ **Si l'écran affiche X€, la base doit contenir X€**

### Implémentation Recommandée

Pour chaque action de rééquilibrage:

```javascript
// ❌ MAUVAIS - Accumulation en mémoire
const actions = [];
actions.push({ type: 'update_budget', budget_id: 1, amount: 100 });
actions.push({ type: 'update_tirelire', amount: -50 });
// ... puis commit à la fin
await commitAll(actions); // NON!

// ✅ BON - Exécution immédiate
await updateBudget(1, 100); // Écrit en DB immédiatement
await updateTirelire(-50);  // Écrit en DB immédiatement
```

### Utilisation de Transactions (Optionnel mais Recommandé)

Si l'implémentation utilise des transactions SQL, la transaction doit:
- ✅ Être **commencée au début** du processus de rééquilibrage
- ✅ **Écrire chaque modification** immédiatement dans la transaction
- ✅ Être **commitée à la fin** du rééquilibrage complet
- ✅ Être **rollback en cas d'erreur** pour garantir la cohérence

```sql
BEGIN TRANSACTION;

-- Étape 1
UPDATE budgets SET economies = economies + surplus WHERE budget_id = 1;
-- Cette modification est visible dans la transaction

-- Étape 2
UPDATE tirelire SET montant = montant + 100;
-- Cette modification est visible dans la transaction

-- ... toutes les autres étapes

COMMIT; -- Seulement à la toute fin
```

---

## Écran Récapitulatif Final

### Objectif

Afficher un résumé complet de l'état financier **après rééquilibrage**, qui doit être **STRICTEMENT IDENTIQUE** à ce qui sera affiché sur le Dashboard.

### Indicateurs à Afficher

#### 1. Reste à Vivre Actuel (Post-Rééquilibrage)
```
Valeur: {RAV_Actuel_Nouveau}€
```

#### 2. Reste à Vivre Budgétaire
```
Valeur: {RAV_Budgétaire}€
```

#### 3. Statut d'Équilibre Final
```
Différence = RAV_Actuel_Nouveau - RAV_Budgétaire

Affichage attendu:
"✅ Équilibre parfait atteint (0€)" ou
"✅ Équilibre atteint (+X€)"
```

**ASSERTION CRITIQUE**:
```
ASSERT: RAV_Actuel_Nouveau - RAV_Budgétaire ≥ 0
```
Si cette assertion échoue, le rééquilibrage a un bug.

#### 4. État des Budgets

Pour chaque budget, afficher:
```
Budget | Montant Estimé | Montant Actuel | Économies
-------|---------------|----------------|----------
Alimentation | 400€ | 400€ | 130€
Transport | 150€ | 150€ | 0€
Vacances | 200€ | 200€ | 350€
```

**ASSERTION CRITIQUE**:
```
Pour chaque budget X:
    Montant_Actuel_Affiché = Montant_Actuel_En_Base
    Économies_Affichées = Économies_En_Base
```

#### 5. Tirelire

```
Tirelire: {Montant_Tirelire_Nouveau}€
```

**ASSERTION CRITIQUE**:
```
Montant_Tirelire_Affiché = Montant_Tirelire_En_Base
```

#### 6. Résumé des Actions Effectuées

Afficher la liste des actions qui ont été exécutées:

**Exemple**:
```
Actions effectuées:
✅ Transfert de 80€ du surplus Alimentation vers économies
✅ Transfert de 50€ du surplus Loisirs vers économies
✅ Renflouage de 50€ pour budget Transport (était déficitaire)
✅ Utilisation de 50€ de la tirelire pour renflouer
✅ Transfert de 100€ des économies vers la tirelire
✅ Suppression de 12 dépenses exceptionnelles
✅ Suppression de 2 revenus exceptionnels
```

### Bouton de Retour au Dashboard

```
[Retour au Dashboard]
```

**Comportement**: Redirige vers le Dashboard principal.

**ASSERTION CRITIQUE**:
```
Après redirection:
    RAV_Dashboard = RAV_Récapitulatif
    Pour chaque budget:
        Montant_Dashboard = Montant_Récapitulatif
        Économies_Dashboard = Économies_Récapitulatif
    Tirelire_Dashboard = Tirelire_Récapitulatif
```

---

## Exemples Détaillés

### Exemple 1: Cas avec Excédent

#### État Initial
```
RAV_Actuel = 1600€
RAV_Budgétaire = 1450€
Différence = +150€ → Excédent

Budgets:
- Alimentation: 400€ estimé, 320€ dépensé → Surplus = 80€, Économies = 100€
- Transport: 150€ estimé, 150€ dépensé → Surplus = 0€, Économies = 0€
- Loisirs: 200€ estimé, 150€ dépensé → Surplus = 50€, Économies = 50€
- Vacances: 200€ estimé, 250€ dépensé → Déficit = 50€, Économies = 300€

Tirelire = 200€
```

#### Déroulement du Rééquilibrage

**Étape 1.1: Transfert Surplus → Économies**
```
Alimentation: Économies = 100€ + 80€ = 180€, Surplus = 0€
Loisirs: Économies = 50€ + 50€ = 100€, Surplus = 0€

UPDATE budgets SET economies = 180, surplus = 0 WHERE nom = 'Alimentation'
UPDATE budgets SET economies = 100, surplus = 0 WHERE nom = 'Loisirs'
```

**Étape 1.2: Calcul Excédent pour Tirelire**
```
Différence_RAV = RAV_Actuel - RAV_Budgétaire = 1600€ - 1450€ = 150€
Excédent_Pour_Tirelire = Différence_RAV = 150€

UPDATE tirelire SET montant = 200 + 150 = 350
```

**Explication**: Les 150€ d'excédent proviennent de revenus exceptionnels et vont donc à la tirelire.

**Étape 1.3: Vérification Budgets Déficitaires**
```
Budget Vacances: 250€ dépensé - 200€ estimé = 50€ de déficit
```

**Étape 1.4.1: Renflouage avec Tirelire**
```
Déficit_Vacances = 50€
Tirelire_Disponible = 350€ (après ajout de l'excédent)
Montant_à_Renflouer = min(50€, 350€) = 50€

UPDATE budgets SET montant_actuel = montant_actuel + 50 WHERE nom = 'Vacances'
UPDATE tirelire SET montant = 350 - 50 = 300
```

#### État Final
```
RAV_Actuel_Nouveau = 1600€ (inchangé, car équilibrage interne)
RAV_Budgétaire = 1450€
Différence = +150€

Budgets:
- Alimentation: 400€, Économies = 180€
- Transport: 150€, Économies = 0€
- Loisirs: 200€, Économies = 100€
- Vacances: 200€, Économies = 300€ (renfloué)

Tirelire = 300€
```

**Explication de l'évolution de la tirelire**:
- État initial: 200€
- Ajout de l'excédent (revenus exceptionnels): +150€ → 350€
- Renflouage du déficit Vacances: -50€ → 300€

---

### Exemple 2: Cas avec Déficit Sévère

#### État Initial
```
RAV_Actuel = 1000€
RAV_Budgétaire = 1450€
Différence = -450€ → Déficit important

Budgets:
- Alimentation: 400€ estimé, 320€ dépensé → Surplus = 80€, Montant actuel = 80€, Économies = 50€
- Transport: 150€ estimé, 130€ dépensé → Surplus = 20€, Montant actuel = 20€, Économies = 30€
- Loisirs: 200€ estimé, 180€ dépensé → Surplus = 20€, Montant actuel = 20€, Économies = 20€

Tirelire = 100€
```

#### Déroulement du Rééquilibrage

**Étape 2.1: Transfert Surplus → Économies**
```
Alimentation: Économies = 50€ + 80€ = 130€, Surplus = 0€
Transport: Économies = 30€ + 20€ = 50€, Surplus = 0€
Loisirs: Économies = 20€ + 20€ = 40€, Surplus = 0€

UPDATE budgets SET economies = 130, surplus = 0 WHERE nom = 'Alimentation'
UPDATE budgets SET economies = 50, surplus = 0 WHERE nom = 'Transport'
UPDATE budgets SET economies = 40, surplus = 0 WHERE nom = 'Loisirs'
```

**Étape 2.2: Utilisation Tirelire**
```
Gap_à_Combler = |1000€ - 1450€| = 450€
Tirelire_Disponible = 100€
Montant_Tirelire_Utilisable = min(450€, 100€) = 100€
Gap_Restant = 450€ - 100€ = 350€

UPDATE tirelire SET montant = 100 - 100 = 0

RAV_Actuel augmente conceptuellement de 100€ → 1100€
```

**Étape 2.3: Utilisation Proportionnelle des Économies**
```
Total_Économies = 130€ + 50€ + 40€ = 220€
Gap_Restant = 350€

Mais Total_Économies (220€) < Gap_Restant (350€)
→ On utilise TOUTES les économies

Prélèvement_Alimentation = 130€
Prélèvement_Transport = 50€
Prélèvement_Loisirs = 40€

UPDATE budgets SET economies = 0 WHERE nom = 'Alimentation'
UPDATE budgets SET economies = 0 WHERE nom = 'Transport'
UPDATE budgets SET economies = 0 WHERE nom = 'Loisirs'

Gap_Restant = 350€ - 220€ = 130€
RAV_Actuel augmente de 220€ → 1320€
```

**Étape 2.4: Prélèvement Proportionnel dans Budgets**
```
Gap_Restant = 130€

Budgets disponibles:
- Alimentation: 80€ (montant actuel après dépenses)
- Transport: 20€
- Loisirs: 20€
Total = 120€

Proportion_Alimentation = 80€ / 120€ = 66.67%
Proportion_Transport = 20€ / 120€ = 16.67%
Proportion_Loisirs = 20€ / 120€ = 16.67%

Prélèvement_Alimentation = 130€ × 66.67% = 86.67€
→ Mais max disponible = 80€ → Prélèvement = 80€

Prélèvement_Transport = 130€ × 16.67% = 21.67€
→ Mais max disponible = 20€ → Prélèvement = 20€

Prélèvement_Loisirs = 130€ × 16.67% = 21.67€
→ Mais max disponible = 20€ → Prélèvement = 20€

Total_Prélevé = 80€ + 20€ + 20€ = 120€
Gap_Restant = 130€ - 120€ = 10€

UPDATE budgets SET montant_actuel = 0 WHERE nom = 'Alimentation'
UPDATE budgets SET montant_actuel = 0 WHERE nom = 'Transport'
UPDATE budgets SET montant_actuel = 0 WHERE nom = 'Loisirs'

RAV_Actuel augmente de 120€ → 1440€
```

**⚠️ Problème**: Il reste encore 10€ de gap et plus aucune ressource.

**Solution**:
1. Soit accepter un gap résiduel (non recommandé)
2. Soit afficher un avertissement à l'utilisateur
3. Soit ajuster le RAV_Budgétaire de -10€ pour forcer l'équilibre

**Implémentation Recommandée**:
```
Si Gap_Restant > 0 après toutes les sources épuisées:
    Afficher un avertissement:
    "⚠️ Impossible d'atteindre l'équilibre parfait.
    Déficit résiduel: {Gap_Restant}€
    Recommandation: Réduire vos budgets estimés ou augmenter vos revenus."

    Ajuster le RAV_Budgétaire:
    RAV_Budgétaire_Ajusté = RAV_Budgétaire + Gap_Restant
```

#### État Final
```
RAV_Actuel_Nouveau = 1440€
RAV_Budgétaire_Ajusté = 1440€ (ou 1450€ avec avertissement)
Différence = 0€ (ou -10€ avec avertissement)

Budgets:
- Alimentation: 400€ estimé, 0€ actuel, 0€ économies
- Transport: 150€ estimé, 0€ actuel, 0€ économies
- Loisirs: 200€ estimé, 0€ actuel, 0€ économies

Tirelire = 0€
```

---

### Exemple 3: Cas Équilibré Parfait

#### État Initial
```
RAV_Actuel = 1450€
RAV_Budgétaire = 1450€
Différence = 0€ → Parfaitement équilibré

Budgets:
- Alimentation: 400€ estimé, 350€ dépensé → Surplus = 50€, Économies = 0€
- Transport: 150€ estimé, 150€ dépensé → Surplus = 0€, Économies = 0€

Tirelire = 100€
```

#### Déroulement du Rééquilibrage

**Étape 1.1: Transfert Surplus → Économies**
```
Alimentation: Économies = 0€ + 50€ = 50€, Surplus = 0€

UPDATE budgets SET economies = 50, surplus = 0 WHERE nom = 'Alimentation'
```

**Étape 1.2: Calcul Excédent pour Tirelire**
```
Différence_RAV = RAV_Actuel - RAV_Budgétaire = 1450€ - 1450€ = 0€
Excédent_Pour_Tirelire = Différence_RAV = 0€

Pas de transfert vers la tirelire (excédent = 0€)
```

**Explication**: Comme il n'y a pas d'excédent, rien ne va à la tirelire. Les surplus ont déjà été transférés vers les économies à l'étape 1.1.

**Étape 1.3: Pas de budgets déficitaires**

#### État Final
```
RAV_Actuel_Nouveau = 1450€
RAV_Budgétaire = 1450€
Différence = 0€

Budgets:
- Alimentation: 400€, Économies = 50€
- Transport: 150€, Économies = 0€

Tirelire = 100€ (inchangée)
```

**Explication de l'évolution de la tirelire**:
- État initial: 100€
- Aucun excédent à ajouter: +0€
- Aucun déficit à renflouer: -0€
- État final: 100€

---

## Assertions et Invariants

### Invariants du Système

#### Invariant 1: Conservation de la Masse Monétaire
```
AVANT rééquilibrage:
Total_Actif = RAV_Actuel + Σ(Montants_Budgets) + Σ(Économies) + Tirelire

APRÈS rééquilibrage:
Total_Actif_Nouveau = RAV_Actuel_Nouveau + Σ(Montants_Budgets_Nouveaux) + Σ(Économies_Nouvelles) + Tirelire_Nouvelle

ASSERT: Total_Actif = Total_Actif_Nouveau
```

**Explication**: L'argent ne se crée ni ne se détruit, il se déplace uniquement.

#### Invariant 2: Équilibre Final Garanti
```
APRÈS rééquilibrage complet:
Différence_Finale = RAV_Actuel_Nouveau - RAV_Budgétaire

ASSERT: Différence_Finale ≥ 0
OU (si impossible): Afficher avertissement explicite
```

#### Invariant 3: Cohérence Base de Données / Affichage
```
Pour chaque donnée X affichée:
    ASSERT: X_Affiché = X_En_Base_De_Données
```

### Tests de Validation

Lors de l'implémentation, exécuter les tests suivants:

#### Test 1: Excédent Simple
```
Input:
- RAV_Actuel = 1500€
- RAV_Budgétaire = 1450€
- 1 surplus de 80€
- Tirelire = 100€

Expected Output:
- Surplus transféré vers économies
- Pas de déficit
- RAV équilibré
```

#### Test 2: Déficit avec Tirelire Suffisante
```
Input:
- RAV_Actuel = 1400€
- RAV_Budgétaire = 1450€
- Gap = -50€
- Tirelire = 100€

Expected Output:
- Tirelire = 50€ (100€ - 50€)
- RAV équilibré
```

#### Test 3: Déficit avec Utilisation d'Économies
```
Input:
- RAV_Actuel = 1200€
- RAV_Budgétaire = 1450€
- Gap = -250€
- Tirelire = 100€
- Économies: Budget A = 100€, Budget B = 200€

Expected Output:
- Tirelire = 0€
- Gap après tirelire = -150€
- Économies Budget A ≈ 50€ (réduit de 50€)
- Économies Budget B ≈ 100€ (réduit de 100€)
- RAV équilibré
```

#### Test 4: Déficit Sévère avec Prélèvement dans Budgets
```
Input:
- RAV_Actuel = 1000€
- RAV_Budgétaire = 1450€
- Gap = -450€
- Tirelire = 0€
- Économies = 0€
- Budget A: 100€ actuel
- Budget B: 200€ actuel

Expected Output:
- Budget A réduit proportionnellement
- Budget B réduit proportionnellement
- RAV équilibré (ou avertissement si impossible)
```

#### Test 5: Renflouage de Budget Déficitaire
```
Input:
- RAV_Actuel = 1500€ (excédent)
- Budget X: -50€ (déficitaire)
- Tirelire = 200€

Expected Output:
- Budget X renfloué à 0€
- Tirelire = 150€
```

---

## Notes d'Implémentation

### Ordre d'Exécution Strict

L'ordre des étapes est **CRITIQUE** et doit être respecté:

1. Transfert des surplus vers économies
2. Calcul et gestion de la différence RAV
3. Renflouage des budgets déficitaires
4. Nettoyage des exceptionnels
5. Affichage récapitulatif

### Gestion des Erreurs

En cas d'erreur lors du rééquilibrage:

```
SI erreur ALORS:
    1. Rollback de TOUTES les modifications en base
    2. Afficher message d'erreur explicite à l'utilisateur
    3. Logger l'erreur pour débogage
    4. Permettre à l'utilisateur de réessayer ou d'annuler
```

### Précision des Calculs

**IMPORTANT**: Utiliser une précision de **2 décimales** pour tous les montants monétaires.

```javascript
// Arrondir à 2 décimales
const arrondir = (montant) => Math.round(montant * 100) / 100;
```

### Gestion des Cas Limites

#### Cas 1: Tirelire à 0€
```
Si Tirelire = 0€:
    Passer directement à l'utilisation des économies
```

#### Cas 2: Aucune Économie Disponible
```
Si Total_Économies = 0€:
    Passer directement au prélèvement dans les budgets
```

#### Cas 3: Tous les Budgets à 0€
```
Si Σ(Montants_Budgets) = 0€:
    Afficher avertissement: "Impossible de rééquilibrer, aucune ressource disponible"
    Proposer à l'utilisateur d'ajuster manuellement
```

#### Cas 4: Gap Impossible à Combler
```
Si après toutes les sources, Gap_Restant > 0:
    Option 1: Ajuster RAV_Budgétaire (recommandé)
    Option 2: Afficher avertissement et accepter le gap
```

---

## Conclusion

Cette spécification définit de manière exhaustive le fonctionnement du Monthly Recap. Toute implémentation doit:

✅ Respecter l'ordre des étapes
✅ Garantir la persistance immédiate en base de données
✅ Assurer la cohérence entre affichage et données
✅ Gérer tous les cas limites
✅ Valider les invariants du système

**Cette spécification fait foi et doit être utilisée comme unique source de vérité pour le développement et la validation du Monthly Recap.**

---

## Changelog

| Version | Date | Modification |
|---------|------|--------------|
| 1.0 | 2025-11-29 | Création initiale de la spécification |

---

**Fin du Document**
