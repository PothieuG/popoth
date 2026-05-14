# 18 — ⏰ DORMANT : Plumbing `budget_transfers.monthly_recap_id`

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §5](../CLAUDE.md) + [§8 ❌](../CLAUDE.md) + Sprint Refactor-I5-followup-v3 Option C documented |
| **Type** | décision en attente (architecture audit trail) |
| **Priorité** | Basse |
| **Effort estimé** | L (1-2 jours, 200+ LOC) |
| **Statut** | **⏰ DORMANT — déclencher si consumer applicatif demande accès à cette colonne** |
| **Dépendances** | Aucune (déclenché par trigger externe : nouveau use case audit/recovery/reporting) |
| **Bloque** | — |

## Contexte

CLAUDE.md §5 :

> **`budget_transfers.monthly_recap_id` est nullable best-effort** : seule la route manuelle `app/api/monthly-recap/transfer/route.ts:143` la set (depuis le body, sans validation, optional). Les 5 paths automatiques d'insertion laissent NULL : `lib/recap/step1-persist.ts` étapes 2.3.1 + 2.4.2 (la RPC `transfer_with_savings_debit` n'a pas de paramètre `p_recap_id`, INSERT hardcodé sans la colonne), `app/api/monthly-recap/{auto-balance,balance,complete}/route.ts`. Vérifié cross-codebase (2026-05-11) : **0 applicative consumer** lit/filtre/JOIN sur cette colonne — les 6 SELECT contre `budget_transfers` listent uniquement `from_budget_id, to_budget_id, transfer_amount`. Conséquence : la FK `budget_transfers_recap_id_fkey ON DELETE CASCADE` ne fire pas pour les rows orphelins issus des paths automatiques (accumulation à long terme côté DB, sans impact app). Pas de plumbing prévu tant qu'un consumer ne surface pas — l'effort 200+ LOC (option A du Sprint Refactor-I5-followup-v3) n'est pas justifié sans use case.

CLAUDE.md §8 ❌ :

> **Ne pas ajouter** un consumer qui FILTER/JOIN sur `budget_transfers.monthly_recap_id` sans d'abord plumber `recapId` à travers les 5 paths automatiques (...). Aujourd'hui la colonne est best-effort/NULL pour les paths automatiques. Un JOIN naïf raterait la quasi-totalité des transferts récap. Si tu as un cas d'usage concret (audit trail, recovery, reporting), reprendre l'option A du Sprint Refactor-I5-followup-v3.

## Trigger d'activation

**Activer ce chantier SI** :
- Un consumer applicatif (UI, API, reporting) doit lire `budget_transfers.monthly_recap_id` pour grouper/filter les transferts par récap
- Use case audit trail "Quels transferts sont liés au récap de mois X ?"
- Use case recovery "Annuler tous les transferts du récap de telle date"
- Use case reporting "Statistiques transferts par récap"

**NE PAS activer prématurément** : 0 consumer aujourd'hui, ferait 200+ LOC plumbing pour rien.

## Prompt prêt à l'emploi pour Claude Code (à utiliser le jour J)

> Copier-coller dans une nouvelle session Claude Code SI le trigger arrive.

### 1. Objectif

Plumber `recapId` (ou `monthly_recap_id`) à travers les 5 paths automatiques d'insertion dans `budget_transfers`, pour que la colonne soit toujours renseignée et utilisable par les consumers applicatifs (FILTER/JOIN/CASCADE).

### 2. Contexte technique

**Paths à plumber** :
- `lib/recap/step1-persist.ts` étape 2.3.1 (INSERT direct préservé fail-soft)
- `lib/recap/step1-persist.ts` étape 2.4.2 (utilise `transferWithSavingsDebit` composite RPC)
- `app/api/monthly-recap/auto-balance/route.ts` (multiple sites INSERT)
- `app/api/monthly-recap/balance/route.ts` (sites INSERT)
- `app/api/monthly-recap/complete/route.ts` (sites INSERT — couplé chantier 01 I6)

**Stratégie** :
- **Option A** : étendre la composite RPC `transfer_with_savings_debit` avec un paramètre `p_recap_id` UUID (et autres composite RPC similaires)
- **Option B** : plumber `recapId` à travers tout le flow (props/args), passer en paramètre des INSERT directs

**Pré-requis** : `monthlyRecapId` doit être disponible au moment de l'insert. Soit fetché depuis `monthly_recaps` table (par session_id), soit créé/sauvé en amont du process-step1.

**Migration DB** : étendre les composite RPCs existantes (`transfer_with_savings_debit`, `transfer_savings_between_budgets`, etc.) avec `p_recap_id UUID DEFAULT NULL` paramètre. Backfill data option (mettre à jour les rows existantes via JOIN avec timestamp) à arbitrer.

### 3. Critères d'acceptation

- [ ] Tous les paths automatiques renseignent `monthly_recap_id` (grep `from('budget_transfers').insert` + Read confirme)
- [ ] Tests gated atomicity régressifs passent
- [ ] Nouveau test caract gated : INSERT via process-step1 → row a `monthly_recap_id` non-NULL
- [ ] FK `budget_transfers_recap_id_fkey ON DELETE CASCADE` fonctionne (test : delete monthly_recap → cascade transfer rows)

### 4. Étapes (compactes)

```powershell
# Phase 1 : audit Phase 1 + arbitrage Option A vs B
# Phase 2 : extension composite RPCs (migration SQL)
# Phase 3 : update helpers TS lib/finance/budget-transfers.ts
# Phase 4 : update 5 paths d'insertion
# Phase 5 : tests gated atomicity + caract
# Phase 6 : (optionnel) backfill data existante
# Phase 7 : closeout CLAUDE.md
```

## Pièges connus (le jour J)

- **Backfill data existante** : si la table a déjà des milliers de rows orphelins (NULL recap_id), décider :
  - Option (a) : laisser NULL pour les anciennes (les consumers acceptent les NULL)
  - Option (b) : backfill via JOIN heuristique sur timestamp + user_id (peut être imprécis)
- **Composite RPC sigantures** : changer `p_recap_id` paramètre = breaking change pour tout consumer existant. Faire `DEFAULT NULL` pour rester rétrocompatible.
- **Cross-codebase plumbing** : `recapId` doit traverser process-step1 → step1-persist → applyDecision → composite RPC. Refactor non-trivial.

---

**Estimation totale** : 1-2 jours. Score métier inchangé. **Ne pas activer sans use case concret** — l'effort est conséquent (200+ LOC + migration DB + tests étendus) et 0 consumer aujourd'hui. DORMANT par design.
