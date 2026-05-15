# 13 — auto-balance reversed RPC→INSERT pattern (bug latent atomicité)

> ⚠️ **Prompt DONE 2026-05-15 — STALE, ne plus exécuter.** Livré via Sprint Auto-Balance-Atomic (commit refactor `b5c2158` + closeout CLAUDE.md). Pattern A (savings) fermé via `transferWithSavingsDebit` per-pair (mirror step1-persist.ts step 2.4.2). Pattern B (piggy reversed) reste documenté hors scope — fix nécessite nouvelle composite RPC `transfer_piggy_to_budget_with_insert`, sprint séparé. Voir CLAUDE.md §11 entrée Sprint Auto-Balance-Atomic pour le détail.

## En-tête

| Champ               | Valeur                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée Sprint Atomicity-Expenses **Hors scope** + Sprint Atomicity-Savings **Hors scope** |
| **Type**            | bug latent                                                                                                              |
| **Priorité**        | Moyenne                                                                                                                 |
| **Effort estimé**   | M (demi-journée)                                                                                                        |
| **Statut**          | **Bloqué par chantier 01** (couplé I6)                                                                                  |
| **Dépendances**     | 01 (I6) — l'extraction du domaine monthly-recap stateful crée le contexte propre pour fixer ce pattern                  |
| **Bloque**          | —                                                                                                                       |

## Contexte

CLAUDE.md §11 entrée Sprint Atomicity-Expenses (Hors scope) :

> **Hors scope** (documenté dans le plan) : `savings/transfer/route.ts` 3 cleanup-attempts CRITIQUES préservés Lot 4d → Sprint Atomicity-Savings v2 ; `auto-balance/route.ts` reversed RPC→INSERT pattern → couplé I6 ; `handlePiggyBankAction` piggy→budget direction → diminishing returns ; abstraction `withCompensatingRollback()` → prématurée tant que <5 sites cross-repo.

CLAUDE.md §11 entrée Sprint Atomicity-Savings (Hors scope) :

> **Hors scope** (documenté dans le plan) : ... (b) `auto-balance/route.ts` reversed RPC→INSERT pattern → couplé I6.

**Compréhension** : `app/api/monthly-recap/auto-balance/route.ts` contient **un pattern reversed** par rapport à process-step1 :

- Dans process-step1 (Sprint Refactor-I5) : pattern correct = INSERT budget_transfers d'abord, puis debit cumulated_savings (corrigé Sprint Refactor-I5-followup-v2 via composite RPC `transfer_with_savings_debit`)
- Dans auto-balance : pattern inverse = debit RPC d'abord, puis INSERT budget_transfers **séparément** (à confirmer Phase 1 par Read sur lines L517 vs L583/L621 mentionnées dans le code historique)

**Conséquence bug latent** : si l'INSERT budget_transfers fail après le debit RPC, le debit a déjà commit (RPC atomique single-op) mais l'audit trail row est manquant → DB inconsistante (impossible de tracer le transfert qui a réellement eu lieu).

**Magnitude** : magnitude bug = bug class différent (pas une perte d'argent, mais perte de traçabilité audit). Throws 500 → frontend voit l'erreur, mais le debit a déjà commit côté DB.

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Identifier le pattern reversed `RPC → INSERT` dans `auto-balance/route.ts` (ou son équivalent post-chantier 01 I6 dans `lib/recap/auto-balance-persist.ts`), et le remplacer par la composite RPC atomique appropriée (`transfer_with_savings_debit` Sprint Refactor-I5-followup-v2, ou autre composite à créer si pattern différent).

### 2. Contexte technique

**Fichier concerné** :

- Pré-I6 : `app/api/monthly-recap/auto-balance/route.ts` (~700+ LOC, 53 console.log)
- Post-I6 : si I6 a extrait auto-balance aussi (probable bundling), `lib/recap/auto-balance-persist.ts` ou similaire

**État actuel à confirmer Phase 1** :

- Read `app/api/monthly-recap/auto-balance/route.ts` lines ~517 + ~583/~621 mentionnées CLAUDE.md
- Identifier les call sites `supabase.rpc('update_budget_cumulated_savings', ...)` suivis de `supabase.from('budget_transfers').insert(...)`
- Confirmer que c'est bien le pattern reversed (RPC d'abord, INSERT après)

**Composite RPC existante à reprendre** :

- `transfer_with_savings_debit` (Sprint Refactor-I5-followup-v2) : INSERT budget_transfers + debit cumulated_savings en 1 tx Postgres
- Helper TS `transferWithSavingsDebit` dans `lib/finance/budget-transfers.ts`

**Tests existants pertinents** :

- `lib/__tests__/api-regressions.test.ts` couvre auto-balance partiellement (gated `SUPABASE_API_TESTS=1`)
- 4 cas gated `transfer-with-savings.test.ts` (Sprint Refactor-I5-followup-v2) — atomicity prouvée pour la composite RPC

**Précédents codebase** :

- Sprint Refactor-I5-followup-v2 (CLAUDE.md §11) — création `transfer_with_savings_debit` + helper TS + 4 cas gated atomicity
- Sprint Atomicity-Expenses (CLAUDE.md §11) — pattern miroir `add_expense_with_breakdown`
- Sprint Atomicity-Savings (CLAUDE.md §11) — pattern miroir `transfer_savings_between_budgets`

### 3. Spécifications fonctionnelles attendues

**Cas nominal** : auto-balance fonctionne identique côté response shape + DB outcomes finaux byte-identique. Mais la séquence interne devient atomique :

- Avant : `await rpc.debit(); await db.insert(); // bug if insert fails`
- Après : `await transferWithSavingsDebit({ from, to, amount }) // 1 tx Postgres`

**Cas erreur fail-soft** : si la composite RPC throw, le rollback est automatique (Postgres tx). Le `logger.warn` + `continue` pattern reste possible (fail-soft business logic) sans risque DB inconsistance.

**Cas erreur hard** : si la composite RPC ne s'applique pas au pattern (e.g. INSERT sur table autre que `budget_transfers`), créer une nouvelle composite RPC ad-hoc OU passer en compensating-rollback explicite (mais c'est ce qu'on essaie d'éviter).

### 4. Contraintes techniques

- **Style** : conventions CLAUDE.md §6 strictes
- **Atomicity invariant** : aucune séquence "RPC then INSERT (or vice versa)" ne doit rester dans le route. Soit composite RPC, soit refactor en INSERT-only-then-trigger (architecturalement different).
- **Préserver fail-soft business** : si l'auto-balance étape échoue, le récap doit pouvoir continuer (pas de propagation hard 500). Le logger.warn + continue pattern Sprint Refactor-I5 est l'idiom.
- **Counter `as unknown as SupabaseClient`** : reste à 0
- **Couplage I6** : si I6 extrait auto-balance en `lib/recap/auto-balance-{algorithm,persist}.ts`, ce chantier 13 vit dans le persist layer. Coordonner.

### 5. Critères d'acceptation vérifiables

- [ ] **0 reversed RPC→INSERT** : grep + Read confirme qu'aucune séquence `await supabase.rpc('update_budget_*'); await supabase.from('budget_transfers').insert(...)` ne reste dans le scope auto-balance
- [ ] **Composite RPC utilisée** : `Grep "transferWithSavingsDebit" app/api/monthly-recap/auto-balance/` (ou `lib/recap/auto-balance-`) retourne ≥ 1 hit (ou nouvelle composite RPC dédiée si Phase 1 décide)
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0
- [ ] **format** : `pnpm format:check` exit 0
- [ ] **tests gated `SUPABASE_API_TESTS=1`** : auto-balance cas existants passants byte-identique
- [ ] **tests gated atomicity** : `SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run lib/finance/__tests__/transfer-with-savings.test.ts` 4 cas passants
- [ ] **build** : `pnpm build` exit 0
- [ ] **smoke browser** : flow `/monthly-recap` auto-balance sur compte test → DB rows correctes (budget_transfers + cumulated_savings)

### 6. Tests à écrire ou à mettre à jour

- **Pas de nouveau test pure-unit** requis (les caract gated existants couvrent le contract)
- **Si nouvelle composite RPC** : ajouter 4-6 cas gated dans nouveau fichier `lib/finance/__tests__/<new-rpc>.test.ts` (pattern miroir transfer-with-savings.test.ts)

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : ~99.999 stable (consolidation atomicity)
  - **§5 Architecture critique** : note sur auto-balance pattern (mentionne que c'est désormais atomique)
  - **§11 Roadmap** : entrée `✅ **Sprint Auto-Balance-Atomic**` ou bundlé dans entrée chantier 01 (I6)

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify
git status -s

# 2. Phase 1 audit
# Read app/api/monthly-recap/auto-balance/route.ts lines pertinentes
# OU si I6 fait : Read lib/recap/auto-balance-persist.ts
# Identifier les call sites reversed pattern

# 3. Implementation
# Refactor pour utiliser transferWithSavingsDebit ou créer nouvelle RPC composite
# Préserver fail-soft

# 4. Tests
pnpm test:run
SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run lib/finance/__tests__/transfer-with-savings.test.ts
SUPABASE_API_TESTS=1 pnpm test:run lib/__tests__/api-regressions.test.ts

# 5. Smoke browser
pnpm dev
# Flow auto-balance sur compte test
```

## Pièges connus / points d'attention

- **Couplage I6** : faire chantier 01 d'abord pour éviter refactor double. Si I6 a extrait auto-balance, ce chantier devient trivial (juste swap helper dans persist layer).
- **Phase 1 obligatoire** : confirmer que le pattern reversed est BIEN encore présent (les line numbers L517/L583/L621 datent d'avant Sprint Refactor-Architecture-v4 + Sprint Atomicity-Savings, peuvent avoir bougé)
- **Hard 500 vs fail-soft** : auto-balance est typiquement fail-soft (continue le récap si une étape échoue). Préserver cette sémantique.
- **Pre-existing dirty working tree** : exclure des commits.

## Découpage en sous-tâches (M → 2-3 commits)

1. **Sub-1 (Effort : XS)** — Phase 1 audit (confirmer pattern + line positions actuelles).
2. **Sub-2 (Effort : S/M)** — Refactor reversed → atomic via composite RPC. Commit `refactor(monthly-recap): atomic transferWithSavingsDebit in auto-balance`.
3. **Sub-3 (Effort : XS)** — Closeout doc.

## Recovery path

- `git revert` du commit refactor. Pas de migration DB (composite RPC déjà en place depuis Sprint Refactor-I5-followup-v2).

## Précédents codebase (références)

- Sprint Refactor-I5-followup-v2 (CLAUDE.md §11) — composite RPC `transfer_with_savings_debit`
- Sprint Atomicity-Expenses + Atomicity-Savings — patterns composite RPC similaires

---

**Estimation totale** : demi-journée. Ferme un bug latent atomicity dans auto-balance. Score métier ~99.999 stable. Recommandé bundle dans le chantier 01 (I6) pour cohérence.
