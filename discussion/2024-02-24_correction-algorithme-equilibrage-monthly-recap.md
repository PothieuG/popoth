# Correction de l'algorithme d'équilibrage Monthly Recap

**Date:** 24 février 2024
**Statut:** Corrections appliquées - En attente de tests

---

## Résumé exécutif

Correction d'un bug critique dans l'algorithme d'équilibrage du Monthly Recap où le **surplus était automatiquement transféré vers les économies** au lieu d'être utilisé **en dernier recours** pour combler un gap.

---

## Contexte métier

### Définitions clés

| Terme | Description | Stockage |
|-------|-------------|----------|
| **Tirelire** | Réserve d'argent accumulée globalement | Table `piggy_bank.amount` |
| **Économies** | Argent mis de côté des mois précédents par budget | Champ `estimated_budgets.cumulated_savings` |
| **Surplus** | Argent non dépensé CE mois (estimé - dépensé) | Calculé dynamiquement |
| **Gap** | Différence entre RAV actuel et RAV budgétaire à combler | `ravActuel - ravBudgetaire` |

### Règle métier fondamentale

> Le surplus **NE devient PAS automatiquement** des économies.
> Il reste "surplus" jusqu'à ce que:
> 1. Il soit utilisé pour combler un gap
> 2. OU l'utilisateur décide de le transférer vers les économies (bouton à l'écran 2)

---

## Problème identifié

### Symptômes observés (CAS 6)

**Écran 1 (avant équilibrage):**
- Tirelire: 500€
- Économies: 0€
- Surplus: 470€
- Gap à combler: 660€

**Écran 2 (après équilibrage) - BUG:**
- Tirelire: 0€
- Économies: **470€** ❌ (surplus transféré automatiquement!)
- Surplus: **0€** ❌

**Écran 2 - ATTENDU:**
- Tirelire: 0€ (500€ utilisés)
- Économies: 0€ (pas utilisées car vides)
- Surplus: **310€** (470€ - 160€ utilisés)

### Cause racine

Dans `app/api/monthly-recap/process-step1/route.ts`:
- **ÉTAPE 1.1 (CAS 1)** et **ÉTAPE 2.1 (CAS 2)** transféraient automatiquement TOUT le surplus vers les économies AVANT d'utiliser les ressources pour combler le gap.

### Algorithme AVANT correction (FAUX)

```
1. Transférer TOUT surplus → économies  ❌
2. Utiliser tirelire pour gap
3. Utiliser économies pour gap
4. Prélever dans budgets
```

### Algorithme APRÈS correction (CORRECT)

```
1. Utiliser tirelire pour combler le gap
2. Si insuffisant, utiliser économies
3. Si insuffisant, utiliser surplus (EN DERNIER)
4. Le surplus restant reste comme "surplus" (pas transféré)
5. À l'écran 2, l'utilisateur peut choisir de répartir le surplus
```

---

## Corrections apportées

### Fichier 1: `app/api/monthly-recap/process-step1/route.ts`

#### Changements principaux

1. **Supprimé** l'ancienne étape 1.1 (CAS 1) qui transférait surplus → économies
2. **Supprimé** l'ancienne étape 2.1 (CAS 2) qui transférait surplus → économies
3. **Nouvel ordre d'utilisation** pour CAS 2:
   - Étape 2.1: Tirelire
   - Étape 2.2: Économies
   - Étape 2.3: Surplus (EN DERNIER)
4. **Renumérotation** de toutes les étapes

#### Nouveau commentaire docblock

```typescript
/**
 * API POST /api/monthly-recap/process-step1
 *
 * ALGORITHME CORRIGÉ - Ordre: Tirelire → Économies → Surplus
 *
 * CAS 1 (Différence ≥ 0 - Excédent):
 *   1.1. Transférer l'excédent → tirelire
 *   1.2-1.3. Renflouer budgets déficitaires
 *   NOTE: Les surplus NE SONT PAS automatiquement transférés vers économies.
 *
 * CAS 2 (Différence < 0 - Déficit):
 *   2.1. Utiliser tirelire
 *   2.2. Utiliser économies proportionnellement
 *   2.3. Utiliser surplus des budgets (EN DERNIER)
 *   2.4. Le surplus restant reste comme "surplus"
 */
```

### Fichier 2: `app/api/monthly-recap/step2-data/route.ts`

#### Changements

1. **Retiré** `last_surplus_transfer_date` de la requête SELECT
2. **Supprimé** la logique qui mettait le surplus à 0 si transféré ce mois
3. **Simplifié** le calcul du surplus:

```typescript
// AVANT (incorrect)
const surplusAlreadyTransferred = budget.last_surplus_transfer_date?.startsWith(currentMonthStr)
const surplus = surplusAlreadyTransferred ? 0 : Math.max(0, difference)

// APRÈS (correct)
const surplus = Math.max(0, difference)
```

---

## Autres fichiers modifiés (session précédente)

### `app/api/savings/transfer/route.ts`

Ajout de la fonction `handlePiggyBankAction()` pour supporter les actions:
- `set_piggy_bank`: Définir le montant de la tirelire
- `add_to_piggy_bank`: Ajouter à la tirelire
- `remove_from_piggy_bank`: Retirer de la tirelire

### `app/api/debug/populate-negative-savings-only/route.ts`

Ajout de la création des revenus (estimated_incomes et real_income_entries) qui manquait, causant un RAV budgétaire négatif.

---

## Tests de validation

### CAS 6: Scénario de test principal

**Données initiales:**
- Gap à combler: 660€
- Tirelire: 500€
- Économies: 0€
- Surplus: 470€
- Total ressources: 970€

**Déroulement attendu:**
1. Tirelire: 500€ utilisés → reste 0€, gap restant 160€
2. Économies: 0€ disponibles → reste 0€, gap restant 160€
3. Surplus: 160€ utilisés → reste 310€, gap comblé

**Résultat attendu écran 2:**
- Tirelire: **0€**
- Économies: **0€**
- Surplus: **310€**

### Scripts de test (console F12)

```javascript
// 1. Réinitialiser avec scénario balanced-risky
fetch('/api/debug/populate-balanced-risky', {
  method: 'POST',
  credentials: 'include'
}).then(r => r.json()).then(console.log)

// 2. Configurer la tirelire à 500€
fetch('/api/savings/transfer', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  credentials: 'include',
  body: JSON.stringify({
    action: 'set_piggy_bank',
    amount: 500,
    context: 'profile'
  })
}).then(r => r.json()).then(console.log)

// 3. Exécuter le processus d'équilibrage
fetch('/api/monthly-recap/process-step1', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  credentials: 'include',
  body: JSON.stringify({ context: 'profile' })
}).then(r => r.json()).then(console.log)

// 4. Vérifier les données de l'écran 2
fetch('/api/monthly-recap/step2-data?context=profile', {
  credentials: 'include'
}).then(r => r.json()).then(console.log)
```

---

## Fichiers de référence

| Fichier | Rôle |
|---------|------|
| `MONTHLY_RECAP_SPECIFICATION.md` | Spécification fonctionnelle du monthly recap |
| `CLARIFICATION_TIRELIRE.md` | Clarifications sur la tirelire |
| `test.md` | Cas de test avec scripts fetch |
| `reset.md` | Scripts de réinitialisation |

---

## Plan file

Le plan détaillé se trouve dans:
```
C:\Users\gille\.claude\plans\typed-beaming-peacock.md
```

---

## Points d'attention pour futures sessions

1. **Ne jamais transférer automatiquement** le surplus vers les économies
2. L'ordre d'utilisation des ressources est: **Tirelire → Économies → Surplus**
3. Le surplus restant après équilibrage **reste comme surplus** jusqu'à décision utilisateur
4. L'écran 2 permet à l'utilisateur de **choisir** de répartir le surplus vers économies

---

## Statut final

- [x] Modification de `process-step1/route.ts` - Algorithme corrigé
- [x] Modification de `step2-data/route.ts` - Calcul surplus simplifié
- [ ] Test du CAS 6 - En attente de validation utilisateur

**Prochaine étape:** Tester le CAS 6 et valider que l'écran 2 affiche:
- Tirelire: 0€
- Économies: 0€
- Surplus: 310€
