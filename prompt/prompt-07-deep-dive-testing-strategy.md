# Setup I3 — Stratégie de tests (Vitest + premiers tests sur lib financière)

> ⚠️ **STALE — Prompt triagé 2026-05-13.** Le scope I3 a été livré silencieusement entre Sprint 0 (Vitest install + config) et Sprint Refactor-I5-followup-v2 (~21 fichiers de test, 113 cas passants). Bilan Phase 1 audit : 6/12 items déjà livrés (Vitest+config+scripts+CI+doc+>30 tests largement dépassés), 6/12 refusés au triage (YAGNI Playwright, builders, jsdom, @testing-library, fast-check, sanity utils — anti-pattern CLAUDE.md "Don't add half-finished implementations" / "Three similar lines is better than a premature abstraction"). 2 livrables réels : (a) DELETE `lib/monthly-recap-calculations.ts` 399 LOC dead code (0 consumer applicatif cross-codebase, mirror Sprint Dead-Code-Purge) ; (b) 8 tests pure-unit non-gated sur `lib/contribution-calculator.ts` (regression-guard pour ProfileSettingsCard validation). Ne PAS exécuter ce prompt. Voir CLAUDE.md §11 entrée « Sprint Audit-Closeout I3 ». Pattern miroir Sprint Audit-Closeout C2 / C3 / C4 / Templates-Triage / Dead-Code-Purge.

## Contexte

État actuel de la codebase :

- **0 fichier de test** détecté (`find . \( -name "*.test.*" -o -name "*.spec.*" \) | wc -l` → 0).
- Aucun framework installé (pas de Jest, Vitest, Playwright, Testing Library).
- 1 075 LOC de calculs financiers non testés ([lib/financial-calculations.ts](lib/financial-calculations.ts)).
- 58 routes API non testées.
- Logique critique non testée : `expense-allocation`, `monthly-recap-calculations`, `contribution-calculator`.

C'est **le plus gros risque** de la codebase : toute modification est jouée à l'aveugle.

L'objectif est de **mettre en place Vitest**, créer une fondation de tests sur la logique financière pure, et préparer Playwright pour les E2E (sans encore les écrire). Ce chantier est **bloquant** pour I4 (refactor financial-calculations) et I5 (extraction process-step1) — il fournit le filet de sécurité.

## Fichiers à analyser en priorité

- [package.json](package.json) — scripts, deps
- [tsconfig.json](tsconfig.json) — compat path alias `@/*`
- [docs/audit/07-deep-dive-testing-strategy.md](docs/audit/07-deep-dive-testing-strategy.md) — playbook complet
- [docs/audit/05-templates.md](docs/audit/05-templates.md) — section `vitest.config.ts`
- [lib/utils.ts](lib/utils.ts) — pour le premier test sanity
- [lib/financial-calculations.ts](lib/financial-calculations.ts) — cible des tests prioritaires
- [lib/contribution-calculator.ts](lib/contribution-calculator.ts) — cible secondaire
- [lib/monthly-recap-calculations.ts](lib/monthly-recap-calculations.ts) — cible secondaire

## Objectifs précis

1. **Installation Vitest** :
   ```bash
   pnpm add -D vitest @vitest/ui \
     @testing-library/react @testing-library/jest-dom @testing-library/user-event \
     jsdom \
     fast-check
   ```
2. **Configuration** :
   - Créer `vitest.config.ts` (template 05) :
     - `environment: 'jsdom'`.
     - `globals: true`.
     - `setupFiles: ['./vitest.setup.ts']`.
     - Coverage v8, exclude `node_modules/`, `.next/`, `public/`, `**/*.config.*`, `**/*.test.*`, barrels, `database.types.ts`.
     - Thresholds : 60 % lines/functions/statements, 50 % branches.
     - Alias `@` → racine projet.
   - Créer `vitest.setup.ts` :
     ```ts
     import '@testing-library/jest-dom/vitest'
     import { afterEach } from 'vitest'
     import { cleanup } from '@testing-library/react'
     afterEach(() => cleanup())
     ```
3. **Scripts npm** :
   - Ajouter `test`, `test:watch`, `test:ui`, `test:coverage` dans `package.json`.
4. **Premier test sanity check** :
   - Créer `lib/utils.test.ts` qui teste `cn` (de `lib/utils.ts`) :
     - Merge de class names.
     - Dédup de classes Tailwind via `tailwind-merge`.
   - Lancer `pnpm test` → doit passer.
5. **Tests sur la logique financière pure (priorité 1)** :
   - **Si le refactor I4 n'est pas encore fait**, écrire les tests sur l'API actuelle (`calculateRemainingToLiveProfile`, `calculateRemainingToLiveGroup`, `getProfileFinancialData`, `getGroupFinancialData`, `calculateIncomeCompensation`, `calculateBudgetDeficit`).
   - **Si I4 est en cours**, écrire les tests directement dans `lib/finance/__tests__/`.
   - Cas à couvrir (reprendre la liste complète du deep dive section "Que tester en priorité") :
     - Cas nominal : revenu > / = / < dépenses.
     - Cas budgets : non atteint, dépassé, exceptionnel, économies cumulées.
     - Cas tirelire : activée / désactivée.
     - Précision : arrondi 0.01, centimes sans drift.
     - Cas limites : aucun budget, aucun revenu, 100+ budgets, montants énormes, négatifs (input invalide → throw).
6. **Test data builders** :
   - Créer `lib/__test-utils__/builders.ts` avec `makeFinancialData`, `makeBudget`, `makeExpense`, `makeIncome`.
   - Réutiliser dans tous les tests.
7. **Tests sur `contribution-calculator`** (priorité 3) :
   - Cas split entre membres avec ratios variables.
   - Cas membre absent.
   - Cas montants nuls.
8. **Tests sur `monthly-recap-calculations`** (priorité 3) :
   - Cas math du recap (selon ce que le module expose).
9. **Mock Supabase léger** :
   - Créer `lib/__test-utils__/mock-supabase.ts` avec `createMockSupabase()` (cf. template du deep dive).
   - Ne pas l'utiliser pour les fonctions pures — uniquement pour les tests futurs des helpers `lib/finance/piggy-bank.ts` etc.
10. **Préparation Playwright (sans écrire les E2E)** :
    - `pnpm add -D @playwright/test`.
    - `pnpm dlx playwright install --with-deps chromium`.
    - Créer `playwright.config.ts` (template du deep dive).
    - Créer un dossier vide `e2e/` avec un `e2e/.gitkeep`.
    - Ajouter le script `test:e2e`.
    - **Ne pas écrire** d'E2E réels — chantier futur.
11. **Mise à jour CI** :
    - Si `.github/workflows/ci.yml` existe (chantier 04), remplacer le job `test` placeholder par un vrai `pnpm test`.
12. **Documentation** :
    - Mettre à jour `CLAUDE.md` section "Conventions à suivre" : ajouter "Tous les calculs critiques doivent être testés (Vitest)".

## Contraintes techniques

- **Vitest 1.x ou 2.x** — vérifier la compat avec Next 16 / React 19.
- `jsdom` plutôt que `happy-dom` (plus mature pour Testing Library).
- Path alias `@/*` doit fonctionner dans les tests (vérifier via le premier test sanity).
- **Pas de mock fetch global** — les fonctions pures n'en ont pas besoin.
- **Pas d'instance Supabase de test** dans ce chantier (Sprint 4 séparé).
- **Pas de tests E2E** dans ce chantier — uniquement la config Playwright.
- Coverage initiale : viser 60 % sur `lib/`, **ne pas** chercher 90 % immédiatement.
- Préserver le comportement runtime — les tests doivent **valider** le comportement actuel, pas en imposer un nouveau.

## Critères de validation

- `pnpm test` passe.
- `pnpm test:coverage` passe avec ≥ 50 % de couverture sur `lib/financial-calculations.ts` (ou `lib/finance/*` si I4 en cours).
- `pnpm test lib/utils.test.ts` passe (sanity).
- `pnpm typecheck && pnpm lint:check && pnpm build` passent.
- Au moins **30 tests** écrits sur la logique financière pure.
- `lib/__test-utils__/builders.ts` existe et est utilisé dans au moins 5 fichiers de test.
- `playwright.config.ts` existe.
- `e2e/.gitkeep` existe (pas d'E2E réels mais le dossier est versionné).
- CI : `pnpm test` est exécuté à chaque push.

## Instructions pour Claude Code

- **Lire** [docs/audit/07-deep-dive-testing-strategy.md](docs/audit/07-deep-dive-testing-strategy.md) intégralement.
- **Vérifier l'état du chantier I4** : si `lib/finance/` existe déjà, écrire les tests directement là ; sinon, sur l'API actuelle de `lib/financial-calculations.ts`.
- Découper en **6 commits** :
  1. `chore(deps): add vitest, testing-library, jsdom, fast-check, playwright`
  2. `chore(test): vitest config + sanity test on lib/utils`
  3. `test(finance): add data builders and tests on calculateRemainingToLive`
  4. `test(finance): add tests on getFinancialData, income-compensation, budget-deficit`
  5. `test: cover contribution-calculator and monthly-recap-calculations`
  6. `chore(test): scaffold playwright config and update CI`
- **Tester chaque cas limite** explicitement — un `it.each([...])` est préférable à un seul test générique.
- **Ne pas écrire** de tests sur les routes API ni sur les composants dans ce chantier.
- **Ne pas mocker Supabase** lourdement — pour les fonctions pures, tout doit passer par les builders.
- Si un test révèle un bug existant : **ne pas corriger** dans ce chantier, créer une issue et marquer le test `it.fails(...)` ou `it.todo(...)`.
- Mettre à jour `CLAUDE.md` à la fin pour mentionner la convention de test.
