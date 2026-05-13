# Sprint Zod-Rollout v5 — Tests RTL des forms client (closure du chantier Zod)

> ⚠️ Lire d'abord [`CLAUDE.md`](../CLAUDE.md) §6 (Validation Zod + patterns A-H) + §9 (Tests) + §11 entrées Sprint Zod-Rollout v1 → v4 + v3/v4 hors-scope notes "RTL tests dédiés Sprint Zod-v5".
> Le v4 (livré 2026-05-13) a fermé le chantier Zod-client en migrant 14 forms (10 v3 + 2 v4 + 2 PoC v1/v2) sur `useForm` + `zodResolver` et en extrayant `<DecimalFormInput>`. **Zéro test côté client** sur le comportement des forms — toute la couverture vit dans les schemas pure-unit ([lib/schemas/\_\_tests\_\_/](../lib/schemas/__tests__/)). Le v5 ferme ce trou.

## Contexte

À la fin de v4, le bilan client-side est :

- **14 forms migrés** sur `react-hook-form` + `zodResolver(...)` :
  - Auth : `app/connexion/page.tsx` (v3), `app/inscription/page.tsx` (v1 PoC), `app/forgot-password/page.tsx` (v4), `app/reset-password/page.tsx` (v4)
  - Profile : `components/profile/FirstTimeProfileDialog.tsx` (v3), `EditProfileDialog.tsx` (v3)
  - Groups : `components/groups/CreateGroupForm.tsx` (v3)
  - Dashboard : `AddIncomeDialog`, `EditIncomeDialog`, `AddBudgetDialog`, `EditBudgetDialog`, `AddTransactionModal`, `EditTransactionModal`, `EditBalanceModal` (v2/v3)
- **1 composant réutilisable** : [`components/ui/DecimalFormInput.tsx`](../components/ui/DecimalFormInput.tsx) (v4)
- **Patterns A-H documentés CLAUDE.md §6** : dual-type décimal / text-only / edit dialog key-id / factory refine / useRavValidation hors-schema / serverError découplé / useWatch / DecimalFormInput

**Surface de coverage manquante** :

1. **Validation paths client** — chaque schema a son test pure-unit (25+ cas dans `lib/schemas/__tests__/`), mais le wirage RHF + zodResolver côté form n'est jamais exercé en test. Si quelqu'un renomme `path: ['confirmPassword']` dans un schema, aucun test client ne casse.
2. **Server-side error mapping** — les 4 branches de `reset-password/page.tsx` (session_not_found / different-from-old / generic password / fallback) ne sont pas regression-guardées. Même pour la map plus simple de `inscription/page.tsx` (5 branches).
3. **UX critique** :
   - Switch `expense ↔ income` dans `AddTransactionModal` (le `form.reset({ transactionType, ... })` swap propre de branche)
   - `useRavValidation` blocking dans `AddTransactionModal` (Pattern E — hors-schema, consulté post-resolver)
   - Factory schema dans `AddBudgetDialog` / `EditBudgetDialog` (Pattern D — refine balance vs total estimated income)
   - Token state-machine dans `reset-password/page.tsx` (3 sub-states : validating / invalid / form / success)
4. **DecimalFormInput unit tests** — le composant pivot n'a aucun test direct. Si quelqu'un casse la regex ou le comma→dot, on s'en aperçoit au smoke browser, pas en CI.

L'infrastructure de test actuelle (vitest env `node` + 21 fichiers de test, 203 passed / 64 skipped à la fin de v4) **ne couvre pas le JSX**. Il faut installer jsdom + @testing-library/react + @testing-library/user-event pour exercer le DOM côté tests.

## Scope (à arbitrer au lancement)

**Axe 1 — Infrastructure setup (obligatoire si Axes 2+3+4 voulus)** :

- Installer `jsdom@^25` + `@testing-library/react@^16` + `@testing-library/user-event@^14` + `@testing-library/jest-dom@^6` (optional, pour `.toBeInTheDocument()` etc.)
- Mettre à jour [vitest.config.ts](../vitest.config.ts) avec un test conditionnel : env `jsdom` UNIQUEMENT pour les fichiers `*.test.tsx` ou sous `__tests__/client/` ; env `node` reste pour le pure-unit existant. Vitest supporte `environmentMatchGlobs` ou `pool` configuration pour ça.
- Créer un [vitest.setup.ts](../vitest.setup.ts) (à la racine) ou similaire pour `@testing-library/jest-dom/vitest` + cleanup automatique entre tests. Voir [Sprint Audit-Closeout I3 §11](../CLAUDE.md) qui notait `vitest.setup.ts` skippé "sans cleanup jsdom" — désormais justifié.
- Ajouter au CI : `pnpm test:run` continue à tourner sur l'ensemble ; pas de séparation des suites.

**Axe 2 — DecimalFormInput unit tests** (~6-10 cas, prioritaire) :

- [`components/ui/__tests__/DecimalFormInput.test.tsx`](../components/ui/__tests__/) (nouveau dossier)
- Couvrir : (a) regex `^\d*[.,]?\d*$` accepte `12.50` / `12,50` / `12` / ``; rejette`abc`/`12.50.5`/`-`; (b)`allowNegative`accepte`-50`/`-`(partial) /`12` ; (c) comma→dot conversion à l'`onChange`; (d)`aria-invalid`prop propagation ; (e)`field.value === undefined`→ empty string display ; (f)`field.value === 0` → "0" display
- Pattern : wrap dans un `useForm` minimal de test, `render(<TestWrapper />)`, `fireEvent.change` ou `userEvent.type`, assert sur `form.getValues()` ou input `value`

**Axe 3 — Critical paths : auth + money allocation** (~25-30 cas, prioritaire) :

Forms à tester en RTL avec ~3-5 cas chacun :

1. **`app/forgot-password/page.tsx`** (v4) — happy email → success state ; empty email → inline error ; invalid format → inline error ; Supabase rate limit → serverError ; Supabase generic error → serverError. **Mock `supabase.auth.resetPasswordForEmail`** via `vi.mock('@/lib/supabase-client', ...)`.
2. **`app/reset-password/page.tsx`** (v4) — happy update → success → redirect ; password <6 → inline error sur password ; mismatch → inline error sur confirmPassword ; `session_not_found` → serverError "Session expirée" ; `different-from-old` → serverError "Le nouveau mot de passe..." ; generic "password" → serverError "ne respecte pas les critères". **Token state-machine** : mock `supabase.auth.getSession` pour retourner `{ session: null }` → assert invalid state UI rendu ; retourner valid session → form state. **Skip** le redirect 3s ; vérifier juste que `setSuccess(true)` est appelé.
3. **`AddTransactionModal`** (v3) — switch expense ↔ income → `form.reset` swap propre (description/amount/date préservés, FK reset) ; exceptional toggle → FK ignored ; RAV blocking via `useRavValidation` → button disabled + serverError ; happy submit → `onTransactionAdded` callback fired. **Mock** les hooks data (useBudgets, useIncomes, useRealExpenses, useRealIncomes, useFinancialData, useProgressData) avec données fixtures stables.
4. **`AddBudgetDialog`** + **`EditBudgetDialog`** (v3) — Pattern D factory : amount qui rend `newTotal > totalEstimatedIncome` → inline error refine balance. Verifier `useMemo` rebuild quand props changent (e.g. `currentBudgetsTotal` change post-mount).

**Axe 4 — Other forms (smoke RTL)** (~15-20 cas, optionnel) :

- `app/connexion/page.tsx` (v3) — empty email/password → inline ; happy login → `useLogin().handleLogin` called
- `app/inscription/page.tsx` (v1) — happy + 5 server-error branches + password mismatch (déjà couvert serveur via `signupBodySchema` test, mais pas le mapping client)
- `CreateGroupForm` (v3) — empty name / budget ≤ 0 → inline ; happy submit
- `FirstTimeProfileDialog` / `EditProfileDialog` (v3) — empty first_name → inline ; salary < 0 → inline (server schema cap to 999999.99) ; happy submit
- `AddIncomeDialog` / `EditIncomeDialog` (v3) — empty name → inline ; live preview update via useWatch (Pattern G) — assert preview re-renders
- `EditTransactionModal` (v3) — preserve transactionType via prop ; FK read-only design

**Axe 5 — Accessibility audit follow-up** (optionnel, hors test) :

Pendant l'écriture des tests RTL, surfacer + fixer les manques a11y :

- **`aria-describedby`** sur tous les `<Input>` linkant l'error `<p>` (id requis) — aucun form actuel ne le fait. Pattern :
  ```tsx
  <Input aria-invalid={...} aria-describedby={fieldErrors.email ? 'email-error' : undefined} />
  {fieldErrors.email && <p id="email-error">{fieldErrors.email.message}</p>}
  ```
- **`role="alert"`** sur le serverError box (4-5 forms l'utilisent) — annonce le serveur-error aux lecteurs d'écran
- **Focus management** sur form submission failure — focus le premier field en erreur

**Axe 6 — Bonus cleanup** (trivial, optionnel) :

Items mineurs surfacés pendant v4 :

- **`app/dashboard/page.tsx:41`** `'context'` unused-vars warning (lint baseline 181 → 180) — vérifier si `context` est calculé inutilement ou s'il y a un consumer manquant
- **DecimalFormInput onBlur cleanup** — si l'utilisateur tape `12.` puis tab out, la valeur reste `"12."`. Le schema l'accepte (z.coerce.number("12.") = 12), mais un blur handler qui strip le `.` final + `-` final solo serait plus propre UX. Trade-off : si introduit en composant générique, casse les forms qui veulent garder le state partial — préférer optional via prop `cleanOnBlur`
- **Format:check pre-existing 4 issues** (`.claude/settings.json`, `doc2/audit/AUDIT-RESOLUTIONS.md`, `next.config.js`, `prompt/prompt-07-deep-dive-recap-algorithm-v7.md`) — cleaner en passant `pnpm format` sur ces 4 fichiers OU ajouter à `.prettierignore` si volontairement non-formatés

## Décisions à demander à l'utilisateur (Phase 1)

- **Q1 — Scope** :
  - (a) Axe 1+2+3 only (infra + DecimalFormInput + critical paths) ≈ ~35-40 tests, sprint serré
  - (b) Axes 1+2+3+4 (+ smoke des autres forms) ≈ ~55-60 tests, sprint medium
  - (c) Axes 1+2+3+4+5 (+ a11y fixes) — chantier large, peut splitter en v5 + v5-followup
  - (d) Axes 1+2+3+4+5+6 (+ bonus cleanup) — full sweep
- **Q2 — Mock strategy pour Supabase / hooks** :
  - (a) Mock chaque hook (`useBudgets`, etc.) site par site avec données fixtures inline
  - (b) Créer un `lib/__test-utils__/mocks.ts` factory centralisé (mirror le pattern Sprint v2 mocked-test mais étendu côté client)
  - (c) Mock seulement `supabase-client` au plus bas niveau, laisser les hooks tourner avec données réelles → besoin de MSW (Mock Service Worker) pour intercepter fetch
- **Q3 — Découpage commits** :
  - (a) 1 commit par axe (4-6 commits selon scope)
  - (b) 1 commit infra (jsdom + setup) + 1 commit par form (~14 commits) — petit + reviewable mais bruyant
  - (c) Bundle infra avec le premier axe (Axe 2 DecimalFormInput) — 3-5 commits totaux
- **Q4 — Patterns RTL à standardiser** :
  - userEvent vs fireEvent (userEvent recommandé pour fidélité comportement utilisateur, mais async donc plus lent)
  - Convention de fichier : co-located `*.test.tsx` à côté du composant OU `__tests__/client/` séparé du `__tests__/` pure-unit existant ?

## Fichiers concernés

```
A NEW   vitest.setup.ts                                  # @testing-library/jest-dom + cleanup (Axe 1)
M       vitest.config.ts                                 # environmentMatchGlobs jsdom pour *.test.tsx (Axe 1)
M       package.json                                     # +4 dev deps (Axe 1)
A NEW   lib/__test-utils__/render.tsx                    # custom render() helper (Axe 2)
A NEW   lib/__test-utils__/mocks.ts                      # hooks mocks centralisés (Axe 2, optional)
A NEW   components/ui/__tests__/DecimalFormInput.test.tsx # 6-10 cas (Axe 2)
A NEW (×7-12) app/{auth pages}/__tests__/*.test.tsx       # critical paths (Axe 3)
A NEW (×7-10) components/dashboard/__tests__/*.test.tsx   # other forms (Axe 4)
M (×8)  forms touched for a11y                           # aria-describedby + role="alert" (Axe 5)
M       app/dashboard/page.tsx                           # drop 'context' unused (Axe 6)
M       CLAUDE.md                                        # §9 mise à jour test count + §11 entrée v5
```

## Critères de succès

- Si scope (a) : ~35-40 nouveaux tests passent / 0 régression sur les 203 existants
- Si scope (b) : ~55-60 nouveaux tests passent / 0 régression
- Si scope (c)/(d) : + a11y fixes vérifiables (axe-core ou snapshots), lint baseline -1 si Axe 6
- `pnpm verify` exit 0 à chaque commit
- 0 migration DB, 0 nouveau test gated (sauf si Axe 3 nécessite Supabase admin pour stub auth.users — improbable)
- Patterns RTL canoniques documentés dans CLAUDE.md §9 (mock strategy, render helper, convention test file location)

## Verification

```bash
pnpm typecheck && pnpm lint:check && pnpm test:run && pnpm format:check
```

Negative greps :

- `Grep "react-testing-library" components/ui/__tests__/` → 0 hit (utilise `@testing-library/react` standard)
- Positive : `Grep "renderWithForm\|render\(.*Test" components/ui/__tests__/` → ≥1 hit (helper utilisé)

## Smoke browser (deferred)

Pas pertinent — les tests RTL exercent le DOM en isolation. Le smoke browser reste utile pour vérifier les pixels (focus colors, suffixe €, etc.) ; les tests RTL vérifient le comportement (validation, soumission, state machine).

## Out of scope (explicite — déjà roadmappés ailleurs)

- **Playwright / E2E** — Sprint séparé si besoin (refusé Sprint Audit-Closeout I3 "0 use case surfacé"). Si surface E2E émerge, revoir.
- **Sprint Tailwind-v4 / Supabase-Strict-Types / Chantier I6 / Lot 6 console-cleanup / OpenAPI** — roadmappés CLAUDE.md §11.
- **Visual regression / snapshot tests sur le rendu** — bricolage difficile à maintenir, pas inclus.
- **MSW (Mock Service Worker)** sauf décision Q2(c) — overkill pour le scope actuel, mockeons les hooks directement.
- **Coverage report ≥ 80%** — pas un gate, juste un signal. Le sprint vise critical paths, pas couverture exhaustive.

## Risques résiduels

1. **vitest config dual-env** : `environmentMatchGlobs` est marqué deprecated dans Vitest 3+ en faveur de `pool` config. Vérifier la doc Vitest 4.1.5 actuelle ; le pattern peut nécessiter une migration future. Alternative : un seul env `jsdom` pour tous, mais ça ralentit les pure-unit existants (~10-15% selon les tests).

2. **DecimalFormInput unit tests setup** : tester un Controller isolé requiert un wrapper `useForm` minimal. Trade-off entre verbosité par-test (`<form><Controller /></form>` à chaque cas) vs helper `renderWithForm()` qui abstrait — recommandé helper, mais pin clairement dans les tests qu'on teste le composant et pas son wrapper.

3. **Server-side error mapping difficulté** : `reset-password/page.tsx` a 4 branches Supabase parsées via `error.message.includes(...)`. Pour mocker, il faut simuler des objets `Error` réalistes (e.g. `new Error('AuthRetryableFetchError: session_not_found')`). Vérifier que les conditions `includes('session_not_found')` matchent bien le mock.

4. **Token state-machine reset-password** : 3 useState + 1 useEffect → 3 sous-états UI. Test du flow complet (validating → valid → submit → success) nécessite contrôle du timing via `await waitFor()`. Risque : tests fragiles si l'ordre de setState change.

## Pattern miroir

Le sprint reprend la philosophie installée Sprint Refactor-I5-followup-v2 (mocked tests) et Sprint Refactor-Test-Coverage : pin le comportement par test mocked plutôt que de tester l'intégration end-to-end. Ici on pin le UX côté client (form + RHF + zodResolver) plutôt que le DB-side comme dans v2.

## Prochaine étape après v5

Si Axes 1+2+3+4 livrés, la couverture client est complète. **Score estimé après v5** : ~99.995 → ~99.997/100 (consolidation coverage, pas saut métier mais lock-down patterns).

Si Axe 5 (a11y) livré, gain UX réel mesurable.

Pas de "v6" anticipé sauf si des trous coverage émergent après le smoke browser réel.
