# Plan de Corrections - Monthly Recap System

## 🎯 Objectif
Mettre l'implémentation en conformité **ISO** avec la spécification MONTHLY_RECAP_SPECIFICATION.md

---

## 🔴 CORRECTIONS CRITIQUES (BLOCKER)

### 1. **API `/balance` - Refonte complète de l'algorithme**

**Fichier**: `app/api/monthly-recap/balance/route.ts`

**Problèmes**:
- Ne gère que le cas déficit
- Ne gère pas le cas excédent
- Utilise les surplus incorrectement
- Ne prélève pas dans les budgets si nécessaire

**Solution**:
```typescript
// NOUVEAU FLOW

// Étape 1: Déterminer le cas
const difference = RAV_Actuel - RAV_Budgétaire

if (difference >= 0) {
  // === CAS 1: EXCÉDENT ===

  // 1.1. Transférer TOUS les surplus → économies
  for (each budget with surplus) {
    UPDATE estimated_budgets
    SET cumulated_savings = cumulated_savings + surplus
    WHERE budget_id = X
  }

  // 1.2. Calculer et transférer excédent → tirelire
  excédent_pour_tirelire = difference
  UPDATE piggy_bank SET amount = amount + excédent_pour_tirelire

  // 1.3. Identifier budgets déficitaires
  // 1.4. Renflouer budgets déficitaires avec:
  //   - Tirelire d'abord
  //   - Puis économies proportionnellement

} else {
  // === CAS 2: DÉFICIT ===

  gap_à_combler = |difference|

  // 2.1. Transférer surplus → économies
  for (each budget with surplus) {
    UPDATE estimated_budgets
    SET cumulated_savings = cumulated_savings + surplus
  }

  // 2.2. Utiliser tirelire (entièrement si nécessaire)
  montant_tirelire = min(gap, tirelire_disponible)
  gap -= montant_tirelire
  UPDATE piggy_bank SET amount = amount - montant_tirelire

  // 2.3. Utiliser économies proportionnellement
  if (gap > 0) {
    for (each budget with savings) {
      proportion = savings_budget / total_savings
      prélèvement = min(gap * proportion, savings_budget)
      UPDATE estimated_budgets
      SET cumulated_savings = cumulated_savings - prélèvement
      gap -= prélèvement
    }
  }

  // 2.4. Prélever dans les budgets proportionnellement
  if (gap > 0) {
    for (each budget with montant_actuel > 0) {
      proportion = montant_actuel_budget / total_montants_actuels
      prélèvement = min(gap * proportion, montant_actuel_budget)

      // Créer une dépense pour consommer ce montant
      INSERT INTO real_expenses (
        estimated_budget_id = budget_id,
        amount = prélèvement,
        description = "Prélèvement équilibrage récap"
      )

      gap -= prélèvement
    }
  }

  // 2.5. Après équilibrage, vérifier s'il reste un excédent
  if (gap == 0 && new_difference > 0) {
    // Cas où après équilibrage il y a un excédent
    // Transférer à la tirelire
  }

  // 2.5.3. Renflouer budgets déficitaires s'il reste des ressources
}
```

---

### 2. **API `/complete` - Corrections majeures**

**Fichier**: `app/api/monthly-recap/complete/route.ts`

**Problèmes**:
- Supprime TOUTES les dépenses/revenus (pas seulement exceptionnels)
- Les surplus sont transférés ici MAIS aussi dans `/balance`
- Pas de renflouage des budgets déficitaires

**Solution**:

#### A. **Supprimer le transfert surplus → économies de `/complete`**
- Cette logique doit être dans `/balance` uniquement
- `/complete` ne fait que la persistance finale

#### B. **Changer la logique de suppression**
```typescript
// AVANT (INCORRECT):
DELETE FROM real_expenses WHERE profile_id = X

// APRÈS (CORRECT):
DELETE FROM real_expenses
WHERE profile_id = X
AND is_exceptional = false  // Garder les exceptionnels du nouveau mois

// OU MIEUX: Supprimer seulement les transactions du mois PRÉCÉDENT
DELETE FROM real_expenses
WHERE profile_id = X
AND expense_date < FIRST_DAY_OF_CURRENT_MONTH
```

#### C. **Renflouer les budgets déficitaires**
```typescript
// Après calcul des déficits ET AVANT suppression des données

for (each budget with deficit) {
  // Essayer de renflouer avec tirelire d'abord
  montant = min(deficit, tirelire_disponible)

  // Créer une dépense NÉGATIVE (crédit) pour renflouer
  INSERT INTO real_expenses (
    estimated_budget_id = budget_id,
    amount = -montant,  // NÉGATIF = crédit
    description = "Renflouage déficit depuis tirelire"
  )

  deficit -= montant
  tirelire_disponible -= montant

  // Si déficit restant, utiliser économies proportionnellement
  if (deficit > 0) {
    // Logique économies proportionnelles
  }
}
```

---

### 3. **API `/step1-data` - Clarification**

**Fichier**: `app/api/monthly-recap/step1-data/route.ts`

**Problèmes**:
- Calcule correctement les données ✅
- Mais pourrait clarifier les noms

**Solution**:
- Renommer `normal_remaining_to_live` → `current_remaining_to_live`
- Ajouter un flag `has_exceptional_income` pour distinguer l'excédent pur des revenus exceptionnels

---

### 4. **Créer nouvelle API `/api/monthly-recap/process-step1`**

**Nouveau fichier**: `app/api/monthly-recap/process-step1/route.ts`

**But**: Exécuter l'algorithme complet de l'Étape 1 (actuellement split entre `/balance` et `/accumulate-piggy-bank`)

**Flow**:
```typescript
POST /api/monthly-recap/process-step1
Body: { context: 'profile' | 'group' }

→ Calcule difference = RAV_Actuel - RAV_Budgétaire
→ Exécute Cas 1 OU Cas 2 selon difference
→ Retourne état final avec toutes les opérations effectuées

Response: {
  success: true,
  case: 'surplus' | 'deficit' | 'balanced',
  operations_performed: [...],
  final_rav: X,
  final_piggy_bank: Y,
  deficit_budgets_refloated: [...]
}
```

---

## 🟡 CORRECTIONS MOYENNES

### 5. **Éviter la double comptabilisation des surplus**

**Solution**: Les surplus doivent être "marqués comme traités" après Step1

**Options**:
- Option A: Ajouter un champ `surplus_transferred_at` dans `estimated_budgets`
- Option B: Transférer immédiatement surplus → économies dès Step1
- **Option C (RECOMMANDÉE)**: Les surplus ne sont transférés qu'UNE FOIS dans `/process-step1` (nouvelle API)

---

### 6. **Gestion des dépenses exceptionnelles**

**Fichier**: `app/api/monthly-recap/complete/route.ts`

**Changement**:
```typescript
// Garder les exceptionnelles du mois en cours
DELETE FROM real_expenses
WHERE profile_id = X
AND (
  is_exceptional = false
  OR expense_date < FIRST_DAY_OF_CURRENT_MONTH
)
```

---

### 7. **Créer une API de vérification post-recap**

**Nouveau fichier**: `app/api/monthly-recap/verify/route.ts`

**But**: Vérifier les invariants après le recap

```typescript
GET /api/monthly-recap/verify?context=profile

Vérifie:
- Conservation masse monétaire
- RAV_Actuel - RAV_Budgétaire >= 0
- Tous les budgets déficitaires ont été renfloués
- Pas de surplus restants (tous transférés aux économies)

Response: {
  success: true,
  checks: [
    { name: 'mass_conservation', passed: true },
    { name: 'rav_balanced', passed: true },
    { name: 'no_deficits', passed: true },
    { name: 'surpluses_transferred', passed: true }
  ],
  warnings: [],
  errors: []
}
```

---

## 🟢 AMÉLIORATIONS (NON-BLOQUANTES)

### 8. **Ajouter des snapshots de vérification**

**Nouveau**: Table `monthly_recap_audit_log`

```sql
CREATE TABLE monthly_recap_audit_log (
  id UUID PRIMARY KEY,
  monthly_recap_id UUID REFERENCES monthly_recaps(id),
  step TEXT NOT NULL,  -- 'step1', 'step2', 'complete'
  operation TEXT NOT NULL,  -- 'surplus_transfer', 'piggy_bank_add', etc.
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**But**: Traçabilité complète de toutes les opérations

---

## 📊 SCRIPTS SQL NÉCESSAIRES

### Script 1: Nettoyage des champs legacy

```sql
-- Les champs monthly_surplus et monthly_deficit ne sont plus utilisés
-- selon la spec, on peut les supprimer OU les garder en legacy

-- Option: Ajouter un commentaire
COMMENT ON COLUMN estimated_budgets.monthly_surplus IS 'DEPRECATED: Not used in current implementation';
COMMENT ON COLUMN estimated_budgets.monthly_deficit IS 'DEPRECATED: Not used in current implementation';
```

### Script 2: Ajouter champ de traçabilité

```sql
-- Pour éviter double comptabilisation
ALTER TABLE estimated_budgets
ADD COLUMN last_surplus_transfer_date DATE;

COMMENT ON COLUMN estimated_budgets.last_surplus_transfer_date IS 'Date du dernier transfert de surplus vers économies';
```

---

## 🎯 ORDRE D'EXÉCUTION RECOMMANDÉ

1. ✅ **Créer `/process-step1`** (nouveau) - Remplace `/balance` + `/accumulate-piggy-bank`
2. ✅ **Modifier `/complete`** - Corriger suppression et renflouage
3. ✅ **Mettre à jour frontend** - Utiliser nouvelle API `/process-step1`
4. ✅ **Tests end-to-end** - Vérifier tous les cas
5. ⚠️ **Migration données** - Si nécessaire (probablement pas)
6. ✅ **Créer `/verify`** - Pour validation post-recap

---

## 📝 NOTES IMPORTANTES

### Sur la conservation de la masse monétaire

**SPEC Invariant 1**:
```
Total_Actif_Avant = Total_Actif_Après
```

**Vérification**:
```typescript
const avant = {
  rav: 1250,
  budgets_disponibles: 500,
  économies: 200,
  tirelire: 100,
  total: 2050
}

const après = {
  rav: 1450,
  budgets_disponibles: 300,
  économies: 250,
  tirelire: 50,
  total: 2050  // DOIT ÊTRE ÉGAL
}
```

### Sur le prélèvement dans les budgets

Quand toutes les autres sources sont épuisées, on DOIT prélever dans les budgets eux-mêmes:

```typescript
// Exemple: Gap de 100€, plus rien d'autre disponible
// Budget Alimentation: 300€ disponibles sur 400€ estimés
// Budget Transport: 100€ disponibles sur 150€ estimés
// Total disponible: 400€

proportion_alimentation = 300/400 = 75%
proportion_transport = 100/400 = 25%

prélèvement_alimentation = 100 * 0.75 = 75€
prélèvement_transport = 100 * 0.25 = 25€

// Créer des dépenses pour "consommer" ces montants
INSERT INTO real_expenses (budget=Alimentation, amount=75€)
INSERT INTO real_expenses (budget=Transport, amount=25€)
```

---

## ✅ CHECKLIST FINALE

- [ ] API `/process-step1` créée et testée
- [ ] API `/complete` modifiée et testée
- [ ] Frontend mis à jour pour utiliser `/process-step1`
- [ ] Tests Cas 1: Excédent (difference >= 0)
- [ ] Tests Cas 2: Déficit léger (tirelire suffit)
- [ ] Tests Cas 2: Déficit moyen (tirelire + économies)
- [ ] Tests Cas 2: Déficit sévère (tirelire + économies + budgets)
- [ ] Tests: Budgets déficitaires renfloués
- [ ] Tests: Surplus transférés aux économies
- [ ] Tests: Conservation masse monétaire
- [ ] Tests: Pas de double comptabilisation
- [ ] API `/verify` créée (optionnel mais recommandé)
- [ ] Documentation mise à jour

---

**FIN DU PLAN DE CORRECTIONS**
