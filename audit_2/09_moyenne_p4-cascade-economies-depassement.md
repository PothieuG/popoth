# 09 — P4 : Cascade économies sur dépassement budget

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [next-steps.md P4](../next-steps.md) (backlog produit) |
| **Type** | feature (extension allocation logique) |
| **Priorité** | Moyenne |
| **Effort estimé** | L (1-2 jours) |
| **Statut** | Non commencé |
| **Dépendances** | (Soft) chantier 10 (P5+P6 modal dépense) — couplé UX |
| **Bloque** | — |

## Contexte

next-steps.md P4 :

> ## P4 — Cascade économies sur dépassement budget
>
> **Domaine** : finances / dépenses
>
> Si un budget dépasse son enveloppe mais qu'il a des économies cumulées, taper dedans **par défaut**. Si le dépassement continue après avoir épuisé les économies du budget, **proposer** à l'utilisateur de prendre dans des économies d'autres budgets.

**Compréhension métier** :
- Phase 1 — auto cascade : si une dépense fait dépasser le budget de destination, **utiliser automatiquement** les économies cumulées de ce budget pour absorber le dépassement
- Phase 2 — proposer cross-budget : si les économies du budget de destination sont insuffisantes après auto-cascade, **proposer interactivement** à l'utilisateur de puiser dans les économies d'autres budgets (UI choix)

**Architecture pertinente** :
- `lib/expense-allocation.ts` (`calculateBreakdown` lecture, `applyAllocation` écriture)
- `lib/finance/expenses.ts::addExpenseWithBreakdown` (Sprint Atomicity-Expenses) — composite RPC qui debit piggy + savings + INSERT en 1 tx
- `lib/api/finance/expenses-add-with-logic.ts` (handler smart-allocation, refacto Sprint Atomicity-Expenses)
- Composite RPC `add_expense_with_breakdown` (`supabase/migrations/20260517000000_*.sql`)
- `components/dashboard/AddTransactionModal.tsx` — UI modal dépense
- `hooks/useRavValidation.ts` — Pattern E (Sprint Zod-Rollout v3) — blocking submit si RAV insuffisant

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Implémenter le mécanisme de cascade économies P4 en 2 phases :
- **Phase 1** : auto-cascade locale au budget de destination (pas de modif UI nécessaire — tout en backend `calculateBreakdown` + RPC composite)
- **Phase 2** : proposition cross-budget interactive (UI step intermédiaire dans AddTransactionModal — couplé chantier 10 P5+P6)

Sans casser les invariants atomicity Sprint Atomicity-Expenses (la séquence debit piggy + savings + INSERT en 1 tx Postgres atomique).

### 2. Contexte technique

**Fichiers concernés (Phase 1 backend)** :
- `lib/expense-allocation.ts::calculateBreakdown` (logique auto-cascade)
- Test Phase 1 audit : confirmer que la logique actuelle utilise déjà piggy → savings_local → budget order, et étendre avec "savings_local seulement si dépassement budget"

**Fichiers concernés (Phase 2 UI cross-budget)** :
- `components/dashboard/AddTransactionModal.tsx` (UI step intermédiaire)
- Possiblement nouveau hook `useCrossBudgetSavingsCascade` ou similaire
- API : potentiellement étendre `addExpenseWithBreakdown` RPC pour supporter multi-budget savings debit OU créer une nouvelle composite RPC `add_expense_with_cross_budget_cascade`
- `lib/schemas/expense.ts` (étendre `addExpenseWithLogicBodySchema` si besoin)

**État actuel à confirmer Phase 1** :
- `calculateBreakdown` ordre actuel : tirelire → économies budget → budget restant (CLAUDE.md §5)
- Smart-allocation déclenche auto si l'utilisateur ne précise pas explicitement (à confirmer UI)
- `AddTransactionModal` : déjà migré Radix Dialog v8 + Pattern E useRavValidation (Sprint Zod-Rollout v3)
- `add_expense_with_breakdown` RPC : input `(amount, from_piggy, from_savings, from_budget, ...)` — à vérifier si elle gère un seul budget de savings ou plusieurs

**Tests existants pertinents** :
- 6 cas gated `add-expense-with-breakdown.test.ts` (Sprint Atomicity-Expenses) — couvrent atomicity
- 5 cas non-gated `expenses-add-with-logic.test.ts` (Sprint Refactor-Test-Coverage) — PIN ATOMIC CONTRACT post-Atomicity-Expenses
- Cas RTL `AddTransactionModal.test.tsx` (Sprint Zod-Rollout v5) — flow happy path

**Précédents codebase** :
- Sprint Atomicity-Expenses (CLAUDE.md §11) — composite RPC `add_expense_with_breakdown`
- Sprint Atomicity-Savings (CLAUDE.md §11) — 2 composite RPC `transfer_savings_between_budgets` + `transfer_budget_to_piggy_bank`
- Sprint Atomicity-Savings v2 (CLAUDE.md §11) — DELETE handlePiggyBankAction (Path B closed-by-deletion)

### 3. Spécifications fonctionnelles attendues

**Cas nominal Phase 1 — Auto-cascade locale** :
- Budget Loyer estimé 800€, cumulated_savings 100€, dépenses déjà 750€ (reste 50€ avant dépassement)
- L'utilisateur ajoute dépense 80€ sur Loyer
- **Comportement attendu** : 50€ pris du budget restant + 30€ pris de cumulated_savings (auto, pas de prompt)
- Atomicity : RPC `add_expense_with_breakdown` exécute les 2 debits + INSERT en 1 tx

**Cas nominal Phase 2 — Proposer cross-budget** :
- Même budget Loyer 800€, savings 100€, déjà 750€ dépenses → reste 50€ avant dépassement
- L'utilisateur ajoute dépense 200€ sur Loyer (50 budget + 100 savings = 150, manque 50€)
- **Comportement attendu** : modal step intermédiaire :
  - "Ce budget Loyer va manquer de 50€. Voulez-vous puiser dans les économies d'un autre budget ?"
  - Liste des budgets avec savings disponibles (e.g. Courses 30€, Loisirs 80€)
  - L'utilisateur choisit "Loisirs 50€"
  - Confirm → la dépense est INSERT avec from_budget=Loyer, from_savings_local=Loyer 100, from_savings_other=Loisirs 50, en 1 tx atomique

**Cas edge** :
- Aucune savings disponible nulle part → le RAV blocking (useRavValidation) doit empêcher submit (déjà actif)
- Dépense exceptionnelle (no estimated_budget_id) → P4 ne s'applique pas, behavior actuel inchangé
- User refuse cross-budget (clique "Annuler" ou "Continuer sans") → soit submit échoue avec erreur métier, soit fallback vers RAV blocking, soit accepte un budget négatif (à arbitrer UX)

**Cas erreur** :
- RPC composite échoue mid-flight → atomic rollback (déjà géré par Sprint Atomicity-Expenses)

### 4. Contraintes techniques

- **Style** : conventions CLAUDE.md §6 strictes
- **Atomicity invariant** : la séquence multi-debit + INSERT DOIT rester en 1 tx Postgres composite. Ne PAS retourner à séquence séparée.
- **RPC update** : si Phase 2 nécessite multi-budget savings, étendre `add_expense_with_breakdown` (préféré) OU créer nouvelle RPC `add_expense_with_cross_budget_cascade`. Décision Phase 1 audit.
- **TS types regen** : si nouvelle RPC, `pnpm db:types` + commit
- **Counter `as unknown as SupabaseClient`** : reste à 0
- **Smoke browser EXHAUSTIF** : la cascade UI est complexe, nécessite test manuel sur compte test avec multiple budgets seedés

### 5. Critères d'acceptation vérifiables

- [ ] **Phase 1 implémentée** : `calculateBreakdown` + `addExpenseWithBreakdown` gèrent l'auto-cascade locale (piggy → savings_local → budget restant)
- [ ] **Phase 2 implémentée** : nouveau step UI dans AddTransactionModal, choix cross-budget, RPC mise à jour
- [ ] **Atomicity préservée** : tests gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` 6+ cas passent (incluant nouveaux cas cross-budget si étendus)
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0, baseline 183 stable
- [ ] **tests non-gated** : 5 cas mocked existants passent + 2-3 nouveaux cas Phase 2 UI
- [ ] **build** : `pnpm build` exit 0
- [ ] **smoke browser** :
  - Cas nominal Phase 1 : dépense qui force cascade locale → auto, pas de prompt
  - Cas nominal Phase 2 : dépense qui force cross-budget → step modal, choix budget source, confirm → atomic
  - Cas edge : aucune savings → RAV blocking actif

### 6. Tests à écrire ou à mettre à jour

#### Nouveaux cas pure-unit `lib/__tests__/expense-allocation.test.ts` (~3-5 cas P4)

```typescript
describe('P4 - Cascade économies', () => {
  it('Phase 1: auto-cascade locale (budget + savings local)', () => {
    const breakdown = calculateBreakdown({
      amount: 80,
      budget: { id: 'b1', remaining: 50, cumulated_savings: 100 },
      piggy: 0,
      crossBudgetCascade: null, // pas de Phase 2
    })
    expect(breakdown).toEqual({ from_budget: 50, from_savings: 30, from_piggy: 0 })
  })
  it('Phase 1: si suffisant budget seul → no savings debit', () => {...})
  it('Phase 2: with crossBudgetCascade param → from_savings_other applied', () => {...})
})
```

#### Mise à jour gated `add-expense-with-breakdown.test.ts` (Sprint Atomicity-Expenses, 6 cas)

Si nouvelle RPC `add_expense_with_cross_budget_cascade`, créer un nouveau fichier de tests gated dédié avec le même pattern (happy / insufficient / 100× concurrent / XOR).

#### Mise à jour RTL `AddTransactionModal.test.tsx`

```typescript
it('P4 Phase 2: opens cross-budget cascade step when local savings insufficient', async () => {...})
it('P4 Phase 2: user can cancel cascade and modify amount', async () => {...})
```

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : ~99.999 stable (consolidation feature)
  - **§5** : section "Allocation des dépenses" — étendre la note pour mentionner P4 cascade
  - **§6 ✅ À faire** : ajouter bullet sur le pattern multi-debit cross-budget
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint P4-Cascade-Economies-Depassement** : ...`
- **next-steps.md** : retirer P4

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify
git status -s

# 2. Phase 1 audit
# Read lib/expense-allocation.ts (logique actuelle)
# Read lib/finance/expenses.ts (helper)
# Read supabase/migrations/20260517000000_create_add_expense_with_breakdown_rpc.sql (RPC SQL signature)
# Read components/dashboard/AddTransactionModal.tsx (UI flow actuel)
# Décider Phase 1+2 architecture (extend RPC vs new RPC)

# 3. Implementation Phase 1 (backend)
# Edit lib/expense-allocation.ts (auto-cascade logic)
# Edit lib/api/finance/expenses-add-with-logic.ts si signature change
# Tests pure-unit
pnpm test:run lib/__tests__/expense-allocation.test.ts

# 4. (Si nouvelle RPC) Migration DB
# Write supabase/migrations/YYYYMMDDHHMMSS_extend_add_expense_for_cross_budget.sql
# node scripts/apply-sql.mjs supabase/migrations/...
# pnpm supabase migration repair --status applied YYYYMMDDHHMMSS
# node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
# pnpm db:types

# 5. Tests gated nouveau si RPC changée
SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run lib/finance/__tests__/<new-test>.test.ts

# 6. Implementation Phase 2 (UI)
# Edit components/dashboard/AddTransactionModal.tsx (step intermédiaire)
# Possible : nouveau composant CascadeSavingsStep
# Tests RTL
pnpm test:run components/dashboard/__tests__/AddTransactionModal.test.tsx

# 7. Validation totale
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm test:run
pnpm build
pnpm verify

# 8. Smoke browser EXHAUSTIF
pnpm dev
# Compte test avec budgets seedés Loyer + Courses + Loisirs avec savings
# Test Phase 1 + Phase 2 + edge cases
```

## Pièges connus / points d'attention

- **Couplage chantier 10 (P5+P6)** : la modal dépense va être refactorée par P5+P6 (option économies + étape 1 type). **Recommandé** : faire P4 et P5+P6 dans le même sprint pour éviter 2 refactors successifs de AddTransactionModal.
- **Atomicity multi-budget cross-cascade** : si l'utilisateur cascade entre 3 budgets, la RPC doit gérer 3 debits + 1 INSERT en 1 tx. Postgres support `SECURITY DEFINER` + `PERFORM` chains — vérifier qu'on peut composer comme `transfer_with_savings_debit` (Sprint v2) le fait.
- **UI complexité** : le step cross-budget cascade peut devenir complexe (liste budgets + slider/input par budget + total équilibré). Réfléchir à l'UX avant d'implémenter — peut-être PoC sur paper/figma d'abord.
- **Concurrent expense** : 2 utilisateurs (group context) ajoutent dépense simultanée sur le même budget → la cascade peut surfaire des conflits. Tester avec 100× concurrent (pattern Sprint Atomicity-Expenses cas 4).
- **Pre-existing dirty working tree** : si chantier 16 pas encore traité, exclure des commits P4.

## Découpage en sous-tâches (L → 6-8 commits)

1. **Sub-1 (Effort : XS)** — Phase 1 audit + décision architecture (extend RPC vs new RPC).
2. **Sub-2 (Effort : S)** — Phase 1 backend `calculateBreakdown` auto-cascade. Commit `feat(finance): auto-cascade local savings on budget overflow (P4 phase 1)`.
3. **Sub-3 (Effort : S)** — Tests pure-unit Phase 1.
4. **Sub-4 (Effort : M)** — (Si nécessaire) Migration DB + helper TS extension RPC. Commit `feat(db): extend add_expense_with_breakdown for cross-budget cascade`.
5. **Sub-5 (Effort : S)** — Tests gated atomicity nouvelle RPC.
6. **Sub-6 (Effort : M)** — Phase 2 UI step intermédiaire AddTransactionModal. Commit `feat(transaction): cross-budget savings cascade UI (P4 phase 2)`.
7. **Sub-7 (Effort : S)** — Tests RTL Phase 2.
8. **Sub-8 (Effort : XS)** — Closeout doc.

## Recovery path

- `git revert` séquentiel par commit (UI puis backend puis DB)
- Migration DB : si nouvelle RPC, créer migration inverse `DROP FUNCTION ...` puis `apply-sql.mjs` + `migration repair` + re-export baseline (pattern Sprint Cleanup-Legacy / C1)

## Précédents codebase (références)

- Sprint Atomicity-Expenses (CLAUDE.md §11) — pattern composite RPC, helper `addExpenseWithBreakdown`, 6 cas gated
- Sprint Atomicity-Savings v2 (CLAUDE.md §11) — pattern composite RPC pour transfers
- Sprint Refactor-Test-Coverage (CLAUDE.md §11) — pattern PIN ATOMIC CONTRACT mocked tests
- Sprint Zod-Rollout v3-v8 (CLAUDE.md §11) — pattern AddTransactionModal refacto + Pattern E useRavValidation

---

**Estimation totale** : 1-2 jours. Ferme P4 du backlog produit. UX significativement améliorée pour les utilisateurs gérant plusieurs budgets avec savings. Score métier ~99.999 stable. Risque modéré (atomicity complexe, UX nouvelle) — bien tester smoke browser exhaustivement avec multiples budgets.
