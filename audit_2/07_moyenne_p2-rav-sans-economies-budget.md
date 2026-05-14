> ⚠️ **STALE — closed-by-pre-existing-fix (2026-05-15, Sprint P2-Closeout-Administrative)** : ce chantier a été triagé comme closeout administratif. Le bug user-perçu n'existe pas dans le code actuel — la formule RAV dans [`lib/finance/calc-rtl.ts`](../lib/finance/calc-rtl.ts) n'inclut pas les `cumulated_savings` (fix antérieur silencieux, JSDoc L16-17 le confirme : "Les économies cumulées ont été SUPPRIMÉES de la formule RAV à la demande utilisateur"). Le `totalSavings` est calculé séparément dans `FinancialData` ([`lib/finance/financial-data.ts:122-129`](../lib/finance/financial-data.ts)) et affiché distinctement par [`components/dashboard/FinancialIndicators.tsx:165-199`](../components/dashboard/FinancialIndicators.tsx). Step1 algorithm consomme `cumulated_savings` directement (pas via le RAV) → 0 impact. Voir [CLAUDE.md §11](../CLAUDE.md) pour le détail. Ce fichier est conservé comme trace historique de l'audit.

# 07 — P2 : RAV calculé sans inclure les économies de budget

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [next-steps.md P2](../next-steps.md) (backlog produit) |
| **Type** | bug calc (RAV gonflé artificiellement) |
| **Priorité** | Moyenne |
| **Effort estimé** | M (demi-journée) |
| **Statut** | Non commencé |
| **Dépendances** | Aucune (peut être fait avant ou après chantier 08 P3) |
| **Bloque** | (Soft) chantier 08 (P3 recalcul RAV revenus) car les 2 touchent la même formule |

## Contexte

next-steps.md P2 :

> ## P2 — RAV calculé sans économies de budget
>
> **Domaine** : finances / RAV calc
>
> Le RAV (Reste À Vivre) doit être calculé **sans inclure** les économies cumulées des budgets — actuellement le calcul les inclut, ce qui gonfle artificiellement le RAV affiché.

**Bug user-perçu** : l'utilisateur voit un RAV plus élevé que la somme réelle qu'il peut dépenser librement. Les économies cumulées des budgets (`estimated_budgets.cumulated_savings`) sont théoriquement "engagées" sur leur budget de destination — les compter dans le RAV donne l'illusion qu'on peut les dépenser librement.

**Impact métier** : décisions financières utilisateur biaisées (perception de marge confortable alors qu'on est plus contraint).

**Architecture pertinente** :
- `lib/finance/calc-rtl.ts` (Sprint Refactor-I4) — 5 helpers pure : `calculateAvailableCash`, `calculateRemainingToLive{Profile,Group}`, `calculateBudgetSavings`, `calculateBudgetDeficit`
- `lib/finance/financial-data.ts` (Sprint Refactor-I4) — `_loadFinancialData(filter, opts)` orchestrateur + 2 wrappers
- 19 cas pure-unit non-gated dans `lib/finance/__tests__/calc-rtl.test.ts` (Sprint Refactor-I4 commit 1) — **vont être impactés**
- 6 cas gated `SUPABASE_FINANCE_TESTS=1` dans `lib/finance/__tests__/financial-data.test.ts` (Sprint Refactor-I4 follow-up) — golden math fixed → **vont devoir être ajustés** si la formule change

**Risque** : bug cascade sur tous les consumers du RAV (dashboard affichage + monthly-recap step1/step2/complete + workflows automatisés). À tester exhaustivement.

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Modifier la formule de calcul du RAV dans `lib/finance/calc-rtl.ts` pour **exclure** la contribution des `cumulated_savings` des budgets, sans casser les invariants comptables (le total de l'argent du système reste cohérent : `bank_balance = RAV + sum(budgets.cumulated_savings) + piggy_bank.amount + ...`). Valider via les 19 cas pure-unit (à ajuster fixtures + asserts) + 6 cas gated golden math + smoke browser exhaustif.

### 2. Contexte technique

**Fichiers concernés** :
- `lib/finance/calc-rtl.ts` (formule à modifier — `calculateRemainingToLiveProfile` + `calculateRemainingToLiveGroup`)
- `lib/finance/__tests__/calc-rtl.test.ts` (19 cas pure-unit, ajuster fixtures + asserts)
- `lib/finance/__tests__/financial-data.test.ts` (6 cas gated, ajuster golden math `incomeContribution`/`remainingToLive`)
- `lib/finance/types.ts` (vérifier si `FinancialData` shape change — si on ajoute `totalBudgetSavings` séparé du RAV par exemple)
- `app/api/monthly-recap/process-step1/__tests__/route.integration.test.ts` (6 cas gated, ajuster fixtures si fixture math impacté)

**Fichiers à consulter (Read-only)** :
- `lib/finance/calc-rtl.ts` — lire la formule actuelle, identifier où `cumulated_savings` rentre dans le calcul
- `lib/finance/financial-data.ts` — comprendre l'ordre d'orchestration (est-ce que `_loadFinancialData` somme `cumulated_savings` séparément ou via `calculateRemainingToLive*` ?)
- `lib/finance/types.ts` — interface `FinancialData` — y a-t-il un champ `totalBudgetSavings` ?
- `components/dashboard/RemainingToLiveIndicator.tsx` ou similaire — UI affichage du RAV
- `lib/recap/step1-algorithm.ts` (Sprint Refactor-I5) — vérifier si l'algorithme étape 2.1+ utilise le RAV avec ou sans savings

**État actuel** :
- Formule probable actuelle (à confirmer par Read) : `RAV = bank_balance + totalRealIncome + totalEstimatedIncomeNotConsumed - totalRealExpenses - totalEstimatedBudgetNotConsumed + sum(budgets.cumulated_savings)`
- L'utilisateur veut : `RAV = bank_balance + totalRealIncome + totalEstimatedIncomeNotConsumed - totalRealExpenses - totalEstimatedBudgetNotConsumed` (sans le `+ sum(cumulated_savings)`)
- **Conséquence comptable** : il faut introduire (ou rendre visible) `totalBudgetSavings` comme champ séparé dans `FinancialData` pour que les UI / step1 algorithm puissent toujours y accéder, mais sans le compter dans le RAV affiché à l'utilisateur

**Tests existants pertinents** :
- 19 cas pure-unit `calc-rtl.test.ts` — formule golden math actuelle, à mettre à jour
- 6 cas gated `financial-data.test.ts` — `incomeContribution = 750 + 200 + 1500 = 2450` puis `remainingToLive = 2450 + 100 - 500 - 80 = 1970` — golden math à recalculer si on retire `cumulated_savings`
- 28 cas pure-unit `step1-algorithm.test.ts` (Sprint Refactor-I5) — vérifier si l'étape 2.1+ dépend du RAV avec savings ou non

**Précédents codebase** :
- Sprint Refactor-I4 (CLAUDE.md §11) — extraction des 5 helpers pure dans `calc-rtl.ts`, 19 cas caractérisation
- Sprint Refactor-I4 follow-up — 6 cas gated golden math dans `financial-data.test.ts`

### 3. Spécifications fonctionnelles attendues

**Cas nominal** :
- L'utilisateur a 1000€ bank_balance, 500€ revenus estimés, 300€ budgets estimés (consumés à 100€ via real_expenses), 50€ cumulated_savings sur un budget
- **Avant fix** : RAV affiché = 1000 + 500 - 300 + 50 = 1250€ (gonflé)
- **Après fix** : RAV affiché = 1000 + 500 - 300 = 1200€ (réel)
- Les économies cumulées (50€) sont visibles dans une autre indicator (e.g. "Économies en attente : 50€" ou via Planning Drawer)

**Cas edge** :
- Utilisateur sans aucun cumulated_savings → RAV inchangé (1000 + 500 - 300 = 1200€ avant et après)
- Utilisateur avec cumulated_savings négatives (théoriquement impossible avec CHECK constraints D8 piggy_bank, mais à vérifier pour estimated_budgets) → comportement défensif
- Group context : même formule, mais sur les agrégats group

**Cas erreur** :
- Aucun nouveau cas erreur introduit (la formule est plus stricte mais déterministe)

### 4. Contraintes techniques

- **Style** : suivre conventions CLAUDE.md §6 (pure functions, immutable, no I/O dans calc-rtl.ts)
- **Invariant comptable** : la somme totale de l'argent ne change pas. Si on retire `cumulated_savings` du RAV, le total `bank_balance` couvre toujours `(RAV + cumulated_savings + piggy + ...)` — vérifier qu'aucun consumer ne fait `RAV + cumulated_savings` en croyant retrouver le bank_balance.
- **`FinancialData` shape** : si on ajoute un champ `totalBudgetSavings: number` séparé, mettre à jour :
  - `lib/finance/types.ts` interface
  - Tous les consumers qui spread `FinancialData` (chercher `...financialData`)
  - Tous les destructurings `const { remainingToLive, ... } = financialData`
- **Tests gated `SUPABASE_FINANCE_TESTS=1`** : recalculer golden math des 6 cas — la valeur `remainingToLive` change selon le scénario
- **Counter `as unknown as SupabaseClient`** : reste à 0
- **Smoke browser CRUCIAL** : tous les flows financiers doivent être validés (RAV affiché ailleurs : dashboard, planning, monthly-recap step1/step2)

### 5. Critères d'acceptation vérifiables

- [ ] **Formule mise à jour** : `Grep "cumulated_savings" lib/finance/calc-rtl.ts` retourne 0 hit dans `calculateRemainingToLive*` (peut rester dans `calculateBudgetSavings` qui est un autre helper)
- [ ] **`totalBudgetSavings` ajouté à FinancialData** (si décidé en Phase 1) : interface mise à jour, calculé séparément
- [ ] **typecheck** : `pnpm typecheck` exit 0 (les consumers de `FinancialData` doivent compiler avec la nouvelle shape)
- [ ] **lint** : `pnpm lint:check` exit 0, baseline 183 stable
- [ ] **format** : `pnpm format:check` exit 0
- [ ] **tests pure-unit** : `pnpm test:run lib/finance/__tests__/calc-rtl.test.ts` 19 passants avec asserts mis à jour (golden math change)
- [ ] **tests gated finance** : `SUPABASE_FINANCE_TESTS=1 pnpm test:run lib/finance/__tests__/financial-data.test.ts` 6 passants avec golden math ajusté
- [ ] **tests pure-unit step1** : `pnpm test:run lib/recap/__tests__/step1-algorithm.test.ts` 28 passants — VÉRIFIER si l'algorithme dépendait de l'ancienne formule, ajuster si oui
- [ ] **tests gated recap** : `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/` 6 passants byte-identique (le path métier ne devrait pas changer si on n'altère que le chiffre RAV affiché)
- [ ] **build** : `pnpm build` exit 0
- [ ] **smoke browser** :
  - `/dashboard` RAV affiché = bank_balance + revenus - dépenses (vérifier valeur numérique correcte vs avant)
  - `/dashboard` "Économies cumulées" visible séparément (UI à ajuster si nécessaire)
  - `/monthly-recap` step1 + step2 fonctionnent (recap algorithm pas cassé)
  - PlanningDrawer affiche les bonnes valeurs

### 6. Tests à écrire ou à mettre à jour

#### Mise à jour `lib/finance/__tests__/calc-rtl.test.ts` (19 cas)

Pour chaque cas existant, recalculer la valeur `remainingToLive` attendue **sans** `cumulated_savings`. Le test devient :

```typescript
// Cas N (exemple)
it('CAS N: profile avec cumulated_savings → RAV exclut savings', () => {
  const input = {
    bankBalance: 1000,
    totalEstimatedIncome: 500,
    totalRealIncome: 0,
    totalEstimatedBudget: 300,
    totalRealExpenses: 100,
    budgets: [{ id: 'b1', cumulated_savings: 50, /* ... */ }],
  }
  const result = calculateRemainingToLiveProfile(input)
  // Avant : 1000 + 500 - 300 + 50 = 1250
  // Après : 1000 + 500 - 300 = 1200
  expect(result.remainingToLive).toBe(1200)
  expect(result.totalBudgetSavings).toBe(50)  // si on ajoute le champ
})
```

#### Nouveau cas regression-guard

```typescript
it('Regression P2: cumulated_savings does NOT inflate RAV', () => {
  const input = { bankBalance: 1000, totalEstimatedIncome: 0, ..., budgets: [{ cumulated_savings: 999 }] }
  const result = calculateRemainingToLiveProfile(input)
  expect(result.remainingToLive).toBe(1000) // PAS 1999
})
```

#### Mise à jour `lib/finance/__tests__/financial-data.test.ts` (6 cas gated)

Recalculer golden math `incomeContribution` / `remainingToLive` selon les fixtures Supabase test. Vérifier que les valeurs assertées correspondent à la nouvelle formule.

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : ~99.999 stable → ~99.999 stable (consolidation calc, ferme bug user-perçu)
  - **§5 Distinction calculs finance** : la note sur `lib/contribution-calculator.ts` vs `lib/finance/income-compensation.ts` n'est pas concernée. Mais mettre à jour la description de `calc-rtl.ts` si la formule change.
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint P2-RAV-Sans-Savings** : ...`
- **next-steps.md** : retirer P2

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify
git status -s

# 2. Phase 1 audit
# Read lib/finance/calc-rtl.ts (identifier où cumulated_savings entre dans la formule)
# Read lib/finance/financial-data.ts (vérifier l'orchestration)
# Read lib/finance/types.ts (FinancialData interface)
# Read lib/recap/step1-algorithm.ts (vérifier si l'algo dépend de la formule actuelle)
# Read components/dashboard/RemainingToLive*.tsx (UI affichage)

# 3. Implementation
# Edit lib/finance/calc-rtl.ts : retirer + sum(cumulated_savings) de calculateRemainingToLive*
# Edit lib/finance/types.ts : ajouter totalBudgetSavings: number à FinancialData (si décidé)
# Edit consumers FinancialData si shape étendue

# 4. Tests
# Edit lib/finance/__tests__/calc-rtl.test.ts (19 cas à ajuster)
# Edit lib/finance/__tests__/financial-data.test.ts (6 cas gated golden math)
# Add regression-guard cas explicite "P2"
pnpm test:run lib/finance/__tests__/calc-rtl.test.ts
SUPABASE_FINANCE_TESTS=1 pnpm test:run lib/finance/__tests__/financial-data.test.ts

# 5. Validation totale
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm test:run
SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/
pnpm build

# 6. Smoke browser EXHAUSTIF
pnpm dev
# /dashboard : valeur RAV affichée = formule sans savings (vérifier chiffre vs database query manuelle)
# /dashboard : "Économies cumulées" visible quelque part (ajuster UI si besoin)
# /monthly-recap : flow complet step1+step2+complete fonctionne
# Smoke aussi /group-dashboard si applicable
```

## Pièges connus / points d'attention

- **Cascade sur tous les consumers** : grep `Grep "remainingToLive" --type ts --type tsx` cross-codebase pour identifier tous les consumers. Le RAV est affiché à plusieurs endroits (dashboard, planning, monthly-recap), comparé dans le step1 algorithm, sauvegardé dans `bank_balances.current_remaining_to_live`. Vérifier que la nouvelle valeur ne casse aucun invariant.
- **`bank_balances.current_remaining_to_live`** : cette colonne stocke le RAV au moment du dernier snapshot. Si on change la formule, l'ancienne valeur stockée devient interpretable différemment. **Décision** : faut-il backfill les rows existantes ? Probablement non (la valeur stockée est historique, et la nouvelle formule ne s'applique qu'aux futurs calculs).
- **Step1 algorithm dependency** : `decideStep1Allocation` (Sprint Refactor-I5) consomme le RAV calculé. Vérifier dans `lib/recap/step1-algorithm.ts` si la formule est utilisée pour déterminer surplus/deficit. Si oui, l'algorithme va se comporter différemment — **changement métier**, pas juste UI. Confirmer avec user que c'est l'intent.
- **UX : visibilité des économies** : si on retire les économies du RAV, l'UI doit les afficher ailleurs (sinon l'utilisateur perd la trace). Vérifier le dashboard layout actuel et ajouter un indicateur si nécessaire.
- **Golden math des tests gated** : recalculer les 6 cas est mécanique mais sujet à erreur de calcul mental. Faire le diff avant/après pour chaque cas et le documenter dans le test (commentaire `// Avant : X / Après : Y / Différence : -Z (cumulated_savings exclu)`)
- **Regression sur P3 P4** : les chantiers 08 (P3) et 09 (P4) touchent aussi le RAV. Si fait après P2, leur formule de référence est différente. Coordonner.
- **Pre-existing dirty working tree** : si chantier 16 pas encore traité, exclure des commits P2.

## Découpage en sous-tâches (M → 4 commits)

1. **Sub-1 (Effort : XS)** — Phase 1 audit (Read tous les fichiers concernés, identifier la formule actuelle, lister les consumers via grep). Documenter dans le draft.
2. **Sub-2 (Effort : S)** — Modification formule `calc-rtl.ts` + ajustement `FinancialData` interface + ajustement consumers. Commit `fix(finance): exclude cumulated_savings from RAV calculation (P2)`.
3. **Sub-3 (Effort : S)** — Mise à jour 19+6 cas tests + ajout regression-guard. Commit `test(finance): update RAV golden math + add P2 regression-guard`.
4. **Sub-4 (Effort : XS)** — Closeout doc CLAUDE.md + retrait P2 de next-steps.md. Commit `docs: closeout P2 RAV sans savings`.

## Recovery path

- `git revert <sha>` chacun des commits. Pas de migration DB. Les valeurs `bank_balances.current_remaining_to_live` historiques restent inchangées (la formule ne touche que les futurs calculs).
- Recovery testable via `pnpm test:run` qui devrait reverir les tests à leur état pré-fix.

## Précédents codebase (références)

- Sprint Refactor-I4 (CLAUDE.md §11) — extraction `calc-rtl.ts` 5 helpers pure, 19 cas caractérisation
- Sprint Refactor-I4 follow-up — 6 cas gated golden math
- Sprint Refactor-I5 (CLAUDE.md §11) — `step1-algorithm.ts` consume du RAV, vérifier non-cassure

---

**Estimation totale** : demi-journée (4-6h). Ferme P2 du backlog produit. Bug user-perçu (RAV gonflé) éliminé. Score métier ~99.999 stable. Risque modéré — bien tester smoke browser exhaustivement (le RAV est partout).
