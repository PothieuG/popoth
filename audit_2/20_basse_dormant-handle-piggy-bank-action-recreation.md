# 20 — ⏰ DORMANT : `handlePiggyBankAction` recreation

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée Sprint Atomicity-Savings v2 (closed-by-deletion) |
| **Type** | feature (recreation post-deletion) |
| **Priorité** | Basse |
| **Effort estimé** | M (demi-journée) |
| **Statut** | **⏰ DORMANT — déclencher si UX surface besoin set/add/remove tirelire directe** |
| **Dépendances** | Aucune (déclenché par trigger : nouvelle UX request) |
| **Bloque** | — |

## Contexte

CLAUDE.md §11 entrée Sprint Atomicity-Savings v2 :

> **livré par deletion** plutôt que par composite RPC + atomicity refactor. Phase 1 audit cross-codebase a invalidé la prémisse du prompt source : les 3 action types `set_piggy_bank` / `add_to_piggy_bank` / `remove_from_piggy_bank` sont du **dead code** (0 consumer applicatif — seul `budget_to_piggy_bank` est appelé depuis SavingsDistributionDrawer.tsx, → `handleBudgetToPiggyBank` déjà atomique post-v7). User a arbitré **Path B DELETE dead code** plutôt que Path A "exécuter v2 comme planifié".

CLAUDE.md §8 ✅ :

> **`handlePiggyBankAction` (3 action types `set_piggy_bank` / `add_to_piggy_bank` / `remove_from_piggy_bank`) supprimé au Sprint Atomicity-Savings v2** (closed-by-deletion 2026-05-12 — 0 consumer applicatif cross-codebase, dead code confirmed Phase 1 audit). Si un futur UX surface un besoin d'éditer la tirelire directement (set/add/remove valeur absolue), recréer ad-hoc via le pattern composite RPC + helper TS (battle-tested 3 fois : v5-followup-v2 + v6 + v7).

## Trigger d'activation

**Activer ce chantier SI** :
- UX surface besoin de modifier directement la valeur de la tirelire (e.g. "Saisir manuellement 500€ comme nouveau total tirelire")
- Use case "Régularisation manuelle après cash deposit hors-app"
- Use case "Reset tirelire à 0 pour démarrer une nouvelle période"
- Use case "Add montant arbitraire à la tirelire" (différent de transfer depuis budget)

**NE PAS activer prématurément** : la deletion v2 a confirmé 0 consumer cross-codebase. Recréer sans use case = re-introduction dead code.

## Prompt prêt à l'emploi (à utiliser le jour J)

> Copier-coller dans une nouvelle session Claude Code SI UX surface besoin.

### 1. Objectif

Créer un nouvel endpoint `POST /api/savings/piggy-bank-action` (ou similaire) avec discriminator action type (`set` | `add` | `remove`) + montant, backé par une nouvelle composite RPC atomique. Pattern miroir Sprint Atomicity-Savings v7 (`transfer_budget_to_piggy_bank`) + UI dans le drawer ou modal dédiée.

### 2. Contexte technique

**Architecture proposée** :
- Migration SQL : `supabase/migrations/YYYYMMDDHHMMSS_create_piggy_bank_action_rpcs.sql`
  - RPC composite `set_piggy_bank_amount(p_action TEXT, p_amount NUMERIC, p_profile_id UUID, p_group_id UUID)` qui consolide les 3 actions via UPSERT atomique avec partial unique index inference
- Helper TS : `lib/finance/piggy-bank.ts::setPiggyBankAmount({ action, amount, ...filter })`
- Route API : `app/api/savings/piggy-bank-action/route.ts` (avec `withAuthAndProfile` + `parseBody` + nouveau schema Zod `piggyBankActionBodySchema`)
- UI : nouveau composant ou extension `SavingsDistributionDrawer.tsx`

**Patterns à reprendre** :
- Composite RPC pattern Sprint Refactor-I5-followup-v2 + Atomicity-Expenses + Atomicity-Savings (battle-tested 3 fois)
- Discriminated union schema Sprint Zod-Rollout-Money-First (cf. `transferSavingsBodySchema`)
- Tests gated 4-6 cas atomicity (happy 3 actions / insufficient remove / 100× concurrent / XOR)

### 3. Critères d'acceptation

- [ ] Composite RPC déployée + helper TS créé
- [ ] Route API + schema Zod + UI
- [ ] 4-6 cas tests gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` atomicity
- [ ] `EXPECTED_RPCS` dans `scripts/check-rpcs.mjs` 8 → 9
- [ ] Lint baseline stable
- [ ] CLAUDE.md §11 entrée + §8 ✅ pour documenter le pattern

### 4. Étapes (compactes)

```powershell
# Phase 1 : design UX avec user (modal vs drawer, validation rules)
# Phase 2 : migration SQL + helper TS
# Phase 3 : route API + schema Zod
# Phase 4 : UI (modal ou drawer extension)
# Phase 5 : tests gated atomicity + RTL
# Phase 6 : closeout
```

## Pièges connus (le jour J)

- **`set` action sémantique** : si user set 500€ alors que tirelire est à 200€, équivalent à `add 300`. Mais si tirelire est à 800, équivalent à `remove 300`. La RPC doit gérer les 2 directions.
- **Edge case `remove > current`** : refuser via CHECK constraint (déjà en place sur `piggy_bank.amount >= 0`)
- **Audit trail** : faut-il logger les set/add/remove dans une table `piggy_bank_history` ? À arbitrer.
- **Concurrent set** : 2 users simultanés set des valeurs différentes → la dernière gagne. Locking ou last-write-wins acceptable selon UX.

---

**Estimation totale** : demi-journée (RPC + helper + route) + 0.5 jour (UI + tests). Score métier ~99.999 stable. **Ne pas activer sans use case UX concret** — la deletion v2 a confirmé 0 consumer. DORMANT par design.
