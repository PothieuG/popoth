# 21 — ⏰ DORMANT : Audit `real_expenses.amount_from_budget` default 0

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée Sprint Refactor-I5-followup |
| **Type** | bug latent (potentiel deficit calc cassé) |
| **Priorité** | Basse |
| **Effort estimé** | S (1-2h) |
| **Statut** | **⏰ DORMANT — déclencher si bug deficit calc surface en prod** |
| **Dépendances** | Aucune |
| **Bloque** | — |

## Contexte

CLAUDE.md §11 entrée Sprint Refactor-I5 commit 2 :

> **Trouvaille** : `real_expenses.amount_from_budget` doit être set explicitement dans le seed (table default = 0 casse le deficit calc dans `lib/finance/financial-data.ts:138-143`).

CLAUDE.md §11 entrée Sprint Refactor-I5-followup hors scope :

> `amount_from_budget` default 0 audit (sprint dédié) : effort S si bug surface

**Compréhension** :
- La colonne `real_expenses.amount_from_budget` a un default DB = 0 (à confirmer Phase 1)
- Si une ligne est insertée sans préciser cette colonne (e.g. INSERT historique antérieur Sprint Atomicity-Expenses), la valeur est 0
- `lib/finance/financial-data.ts:138-143` (Sprint Refactor-I4) calcule le deficit du budget en utilisant `amount_from_budget` — si la valeur est 0 alors que la dépense fait 100€, le deficit est faux
- Symptôme prod : RAV affiché incorrect, monthly_surplus_deficit incorrect, recap mensuel des budgets incorrect

**État actuel** :
- Sprint Atomicity-Expenses (CLAUDE.md §11) garantit que les nouvelles dépenses set `amount_from_budget` correctement via composite RPC
- Mais les rows historiques (avant Sprint Atomicity-Expenses, 2026-05-12) peuvent avoir `amount_from_budget = 0` à tort
- 0 incident reporté à ce jour

## Trigger d'activation

**Activer ce chantier SI** :
- Un utilisateur signale "le RAV affiché ne correspond pas à la somme manuelle"
- Un audit prod surface des budgets avec deficit incorrect
- Un test gated finance fail post-migration / post-bump avec golden math broken

**NE PAS activer prématurément** : 0 incident reporté, audit préventif = "design for hypothetical".

## Prompt prêt à l'emploi (à utiliser le jour J)

> Copier-coller dans une nouvelle session Claude Code SI bug surface.

### 1. Objectif

Auditer la colonne `real_expenses.amount_from_budget` :
1. Confirmer le default DB (probable 0)
2. Identifier les rows historiques avec `amount_from_budget = 0` mais `estimated_budget_id IS NOT NULL` ET `amount > 0` (= rows incorrectes)
3. Backfill ces rows avec `amount_from_budget = amount` (ou autre formule selon breakdown réel — à valider)
4. Optionnel : changer le default DB à NULL ou rendre la colonne NOT NULL pour forcer l'explicit set

### 2. Contexte technique

**Fichier audit** :
- Read `supabase/migrations/20260101000000_remote_schema.sql` section `real_expenses` table — confirmer default + nullability
- Read `lib/finance/financial-data.ts:138-143` — confirmer la formule deficit utilise `amount_from_budget`

**SQL audit query** (à exécuter via `node scripts/apply-sql.mjs`) :

```sql
-- Identify potentially broken rows
SELECT id, amount, amount_from_budget, estimated_budget_id, expense_date
FROM real_expenses
WHERE estimated_budget_id IS NOT NULL
  AND amount > 0
  AND amount_from_budget = 0
ORDER BY expense_date DESC
LIMIT 50;

-- Count
SELECT COUNT(*) FROM real_expenses
WHERE estimated_budget_id IS NOT NULL
  AND amount > 0
  AND amount_from_budget = 0;
```

**Backfill SQL** (si décision de fix) :

```sql
-- Naive backfill : assume amount_from_budget = amount for non-allocated rows
-- Risk : si la dépense avait été partiellement piggy/savings, ça surestime
-- Better : backfill avec breakdown si savings_used + piggy_used disponibles
UPDATE real_expenses
SET amount_from_budget = amount
WHERE estimated_budget_id IS NOT NULL
  AND amount > 0
  AND amount_from_budget = 0;
```

### 3. Critères d'acceptation

- [ ] Audit query exécutée + count documenté
- [ ] Si count > 0 : backfill décision (full vs partial vs leave) + applied
- [ ] Optionnel : migration DB pour changer default à NULL ou enforce NOT NULL post-Atomicity-Expenses
- [ ] `pnpm verify` exit 0 (pas de regression)
- [ ] `SUPABASE_FINANCE_TESTS=1` 6+ cas passants byte-identique (la formule consume `amount_from_budget` correctement maintenant)

### 4. Étapes (compactes)

```powershell
# Phase 1 : audit query exec
# Phase 2 : décision backfill
# Phase 3 : SQL backfill (via apply-sql.mjs)
# Phase 4 : optionnel migration DB schema change
# Phase 5 : verify + closeout
```

## Pièges connus (le jour J)

- **Backfill naive** : assumer `amount_from_budget = amount` peut être faux si la dépense historique avait `from_piggy > 0` ou `from_savings > 0`. Sans audit colonne `from_piggy` / `from_savings` historique, impossible de calculer exactement. Acceptable si le user accepte une approximation.
- **Migration NOT NULL** : breaking change si on rend la colonne NOT NULL — nécessite backfill complet d'abord
- **Tests gated finance** : peuvent surfacer le bug si fixtures sont set avec `amount_from_budget` correct (Sprint Refactor-I5 commit 2 a installé la fixture correctement, donc les tests passent — mais en prod data peut être différente)

---

**Estimation totale** : 1-2h (audit + backfill simple). Score métier ~99.999 stable. **Ne pas activer sans bug surface** — pattern "design for hypothetical" refused. DORMANT par design.
