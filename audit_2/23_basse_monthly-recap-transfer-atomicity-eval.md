# 23 — `monthly-recap/transfer` manual UI atomicity — évaluation

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée Sprint Atomicity-Savings hors scope |
| **Type** | décision en attente (évaluation atomicity) |
| **Priorité** | Basse |
| **Effort estimé** | S (1-2h) — évaluation seulement (S si décision = "fix") |
| **Statut** | Non commencé |
| **Dépendances** | Aucune |
| **Bloque** | — |

## Contexte

CLAUDE.md §11 entrée Sprint Atomicity-Savings hors scope :

> `monthly-recap/transfer/route.ts` body-driven manual UI transfer pattern différent.

CLAUDE.md §5 :

> `budget_transfers.monthly_recap_id` est nullable best-effort : seule la route manuelle `app/api/monthly-recap/transfer/route.ts:143` la set (depuis le body, sans validation, optional).

**Compréhension** : la route `/api/monthly-recap/transfer` gère les transferts manuels demandés par l'utilisateur depuis l'UI monthly-recap (probablement dans le drawer step1/step2). Différent des transferts automatiques de step1-persist.ts (CAS 2 ÉTAPE 2.3.1, 2.4.2, etc.).

**Question** : ce flow est-il atomique ? Ou contient-il un pattern reversed / compensating-rollback non-fixé par les Sprints Atomicity-* ?

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

**Phase 1 — Évaluation** : audit `app/api/monthly-recap/transfer/route.ts` pour identifier si le flow est atomique ou contient un risk pattern (séquence RPC séparée + INSERT, compensating-rollback manuel, etc.).

**Phase 2 (conditionnel)** — Si atomicity manquante, fixer via composite RPC existante (`transfer_with_savings_debit` ou `transfer_savings_between_budgets` selon shape) ou créer nouvelle composite si pattern différent.

### 2. Contexte technique

**Fichier audit** :
- `app/api/monthly-recap/transfer/route.ts` (handler POST)
- Lecture intentionnelle de la totalité du fichier
- Read aussi `lib/schemas/recap.ts::manualTransferBodySchema` (Sprint Zod-Rollout-Money-First)

**État actuel** :
- Schema Zod en place (Sprint Zod-Rollout-Money-First)
- Pattern réel à confirmer Phase 1 — peut être déjà atomique post Sprint Refactor-I5-followup-v2 (composite RPC) si la route a été touchée

**Composite RPCs disponibles à reprendre si fix nécessaire** :
- `transfer_with_savings_debit` (Sprint Refactor-I5-followup-v2)
- `transfer_savings_between_budgets` (Sprint Atomicity-Savings)
- `transfer_budget_to_piggy_bank` (Sprint Atomicity-Savings)

**Précédents** : Sprints Atomicity-* (CLAUDE.md §11)

### 3. Décision Phase 1

Après audit Read :
- **Cas 1** : route déjà atomique → no-op, mettre à jour ce chantier en "✅ Pas concerné" + closeout
- **Cas 2** : route contient pattern non-atomique → décider Path A fix (utiliser composite RPC existante) vs Path B (créer nouvelle composite si pattern différent)

### 4. Critères d'acceptation

- [ ] Audit Phase 1 documenté (commit message ou note)
- [ ] Si fix : composite RPC utilisée, pas de séquence RPC + INSERT séparée
- [ ] Si fix : tests gated atomicity 4-6 cas (pattern miroir Sprint Atomicity-Savings)
- [ ] CLAUDE.md §11 entrée explicative (no-op ou fix)

### 5. Étapes (compactes)

```powershell
# 1. Pré-flight
pnpm verify

# 2. Phase 1 audit
# Read app/api/monthly-recap/transfer/route.ts (entièrement)
# Read lib/schemas/recap.ts::manualTransferBodySchema
# Identifier pattern (atomique ou non)

# 3. Si fix nécessaire : implementation + tests + closeout
# 4. Si pas concerné : juste closeout doc
```

## Pièges connus

- **Couplage chantier 18** : `monthly_recap_id` est set par cette route (uniquement). Si chantier 18 (DORMANT) s'active un jour, cette route reste le seul site fiable pour audit trail
- **Pre-existing dirty working tree** : exclure des commits

## Découpage

1. **Sub-1 (Effort : XS)** — Audit Phase 1 + décision.
2. **Sub-2 (Effort : S)** — Si fix : implementation + tests. Sinon skip.
3. **Sub-3 (Effort : XS)** — Closeout doc.

## Recovery path

- `git revert` si fix appliqué.

## Précédents codebase

- Sprints Atomicity-* (CLAUDE.md §11)

---

**Estimation totale** : 1-2h évaluation. Score ~99.999 stable. Phase 1 obligatoire avant action.
