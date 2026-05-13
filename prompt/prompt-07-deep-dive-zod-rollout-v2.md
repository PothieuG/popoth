# Sprint Zod-Rollout — v2 (suite Sprint Zod-Rollout-Money-First)

> ⚠️ Lire d'abord [`CLAUDE.md`](../CLAUDE.md) §6 "Validation Zod (parseBody)" + §11 entrée Sprint Zod-Rollout-Money-First.
> Le v1 a livré 13 routes + 1 PoC client. Le v2 ferme le périmètre restant.

## Contexte

Le Sprint Zod-Rollout-Money-First (2026-05-13, commits `f698fcb → 928569e`) a installé `parseBody` + `handleBadRequest` + 9 schemas (`common`, `savings`, `bank-balance`, `profile`, `budget`, `income`, `expense`, `recap` étendu, `auth`) + barrel `index.ts`. **13 routes migrées + InscriptionPage PoC react-hook-form**. Lint 183 stable, tests 145 passés / 64 skipped.

Reste à fermer :

1. **6 handlers oubliés** dans le scoping v1 (vérifié par negative grep post-v1) — `lib/api/finance/budgets-estimated.ts` et `lib/api/finance/income-estimated.ts` ont chacun POST + PUT + DELETE en plus du GET. Ces sites ont encore la validation manuelle `if (!estimated_amount || typeof estimated_amount !== 'number' || estimated_amount <= 0)` (negative grep v1 a flagué les 2 sites à L100/L144). Probablement les schemas `budget.ts` / `income.ts` v1 peuvent être réutilisés ou étendus (la shape `{ name, estimatedAmount }` est identique).
2. **~14 routes hors money-first** non migrées :
   - `app/api/auth/session/route.ts` POST + DELETE (création/destruction session JWT) — auth est complexe, voir contraintes ci-dessous.
   - `app/api/groups/route.ts` POST.
   - `app/api/groups/[id]/route.ts` PATCH + DELETE (dynamic).
   - `app/api/groups/[id]/members/route.ts` POST + DELETE (dynamic).
   - `app/api/groups/contributions/route.ts` POST.
   - `app/api/monthly-recap/initialize/route.ts` POST.
   - `app/api/monthly-recap/recover/route.ts` POST (post-v8 v1/v2 dispatch dans `restoreTable`).
   - `app/api/monthly-recap/update-step/route.ts` PATCH.
3. **GET routes avec query params** : pattern alternatif `schema.safeParse(Object.fromEntries(searchParams))` (cf. deep-dive playbook initial). Routes candidates : `/api/finance/expenses/real` GET (limit, offset, budget_id, exceptional), `/api/finance/income/real` GET (limit, offset, group), `/api/finance/expenses/progress`, `/api/finance/income/progress`, `/api/finance/expenses/preview-breakdown`, `/api/finance/summary`, `/api/finance/rav`, `/api/finance/budgets/estimated` GET, `/api/finance/income/estimated` GET, `/api/finance/budgets` (DELETE par query), `/api/finance/incomes` (DELETE par query), `/api/savings/data` GET, `/api/bank-balance` GET, `/api/profile` GET, `/api/groups/search`, `/api/monthly-recap/{status,refresh,resume,step1-data,step2-data,balance,auto-balance,transfer}` GET.
4. **10+ client forms** restant à migrer vers `react-hook-form` + `zodResolver` :
   - `AddBudgetDialog` (351 LOC) — **prop-dependent balance validation** (`currentBudgetsTotal`, `totalEstimatedIncome` viennent du parent) ; nécessite `watch()` ou superRefine async.
   - `EditBudgetDialog` (239 LOC) — même pattern + async `onSave` retournant Promise<boolean>.
   - `AddIncomeDialog` / `EditIncomeDialog`.
   - `AddTransactionModal` (452 LOC) — **adaptive UI**, conditional fields sur `transactionType` + `isExceptional` ; dispatch sur budget_id vs income_id ; **most complex form**.
   - `EditTransactionModal` (374 LOC).
   - `EditBalanceModal` (136 LOC).
   - `EditProfileDialog` (186 LOC) — extension simple.
   - `FirstTimeProfileDialog` (173 LOC) — extension simple.
   - `CreateGroupForm` (120 LOC).
   - `LoginPage` (`app/connexion/page.tsx`, 134 LOC) — peut partager `signupBodySchema` en partie (email + password sans confirmPassword + refine).
5. **3 routes debug** (`/api/debug/reset-all`, `/retrigger-recap`, `/reset-budgets`) — toutes gated `blockInProduction()` 404 prod. Refused au v1 par arbitrage user. Re-arbitrer si v2 ouvre plus d'appétit pour la couverture exhaustive.

## Décisions d'arbitrage à demander avant exécution

- **Q1 Scope v2 size** : (A) complétion exhaustive (~14 routes + 6 handlers + GET query + 10 client forms + 3 debug = ~30+ items ; 12-15h), (B) routes only (~20 routes ; 6-8h, laisse client forms à v3), (C) money-leftover + auth + groups (les 4 axes plus risk-justifiés ; 8-10h ; recap stateful reste, GET query reporté, client forms reportés), (D) minimal-finish (juste les 6 handlers oubliés + auth session ; ~2-3h).
- **Q2 GET query params** : (A) en scope (utiliser le pattern `safeParse(Object.fromEntries(searchParams))` + un helper `parseQuery`), (B) skip — défer à un sprint dédié (les GET sans body posent moins de risque, le bénéfice est surtout de typer les query params et bloquer les valeurs aberrantes).
- **Q3 Auth session** : la route `/api/auth/session` est l'endroit où la session JWT est créée (POST = login body { email, password }) et détruite (DELETE, no body). User a confirmé skip auth dans v1. Re-confirmer skip en v2 ou inclure ? Si include, partager `signupBodySchema` (déjà créé) - login (sans confirmPassword) — `loginBodySchema = z.object({ email, password })` simple.
- **Q4 Client forms** : (A) tout migrer en v2 (lourd), (B) liste-stricte d'1-3 forms par scope (AddBudgetDialog seul, ou AddBudgetDialog + EditBudgetDialog parce qu'ils partagent le balance refine), (C) reporter à un v3 dédié forms après v2 backend-only.
- **Q5 Debug routes** : re-arbitrer ? Cohérent avec v1 = skip.

## Fichiers à lire en priorité

- [`prompt/prompt-07-deep-dive-zod-rollout.md`](./prompt-07-deep-dive-zod-rollout.md) — playbook complet (le source pre-v1).
- [`CLAUDE.md`](../CLAUDE.md) §6 "Validation Zod" + §11 entrée v1 (référence pour les patterns établis).
- [`lib/api/parse-body.ts`](../lib/api/parse-body.ts) — infra existante.
- [`lib/schemas/`](../lib/schemas/) — schemas v1 (à étendre, pas à réinventer).
- [`lib/api/finance/budgets-estimated.ts`](../lib/api/finance/budgets-estimated.ts) + [`lib/api/finance/income-estimated.ts`](../lib/api/finance/income-estimated.ts) — les 6 handlers oubliés.
- [`app/inscription/page.tsx`](../app/inscription/page.tsx) — modèle PoC client v1.
- Tous les fichiers listés en §2 du scope ci-dessus.

## Objectifs précis

### A. 6 handlers oubliés (priorité absolue — ferme un trou réel)

Pour chaque fichier `lib/api/finance/{budgets,income}-estimated.ts` :

- **POST** : appliquer `parseBody(request, createBudgetBodySchema)` ou `createIncomeBodySchema` (v1 déjà créés). Vérifier que la shape `{ name, estimatedAmount }` est identique. Si oui, **réutiliser** ; si non (e.g. nouveau champ optionnel), créer `createEstimatedBudgetBodySchema` séparé en explicitant pourquoi (cohérent avec CLAUDE.md §6 "Three similar lines"). Wrap avec `handleBadRequest`.
- **PUT** : pareil avec `updateBudgetBodySchema` / `updateIncomeBodySchema`.
- **DELETE** : skip si query param `?id=<uuid>` ; sinon migrer.

**Verification negative grep** :

```powershell
Grep "typeof.*!==.*'number'.*\|\|.*<= 0" --glob "lib/api/finance/{budgets,income}-estimated.ts"
# Attendu : 0 hits post-v2
```

### B. Routes hors money-first (~8 routes restantes)

Pour chaque route, créer / étendre le schema dans le bon `lib/schemas/<domain>.ts` (créer `groups.ts` + extension `auth.ts` + extension `recap.ts`). Schemas à designer :

- **`lib/schemas/auth.ts`** (extend) : `loginBodySchema = z.object({ email, password })`. Réutilise les contraintes du `signupBodySchema` v1 (email + password min 6), sans confirmPassword + refine.
- **`lib/schemas/groups.ts`** (nouveau) :
  - `createGroupBodySchema = z.object({ name: trimmed min 2, monthly_budget_estimate: nonNegativeMoney })`.
  - `updateGroupBodySchema = z.object({ name?: ..., monthly_budget_estimate?: ... }).refine("at-least-one-field")` — pattern miroir profile/expense PUT.
  - `addMemberBodySchema = z.object({ user_id: uuid })` ou `{ email: email }` selon le contrat.
  - `removeMemberBodySchema` ou DELETE par query (skip si query).
  - `contributionsBodySchema = z.object({ ... })` — lire la route pour découvrir la shape exacte.
- **`lib/schemas/recap.ts`** (extend) :
  - `initializeBodySchema = z.object({ context })`.
  - `recoverBodySchema = z.object({ ... v1/v2 dispatch })` — la route a un comportement v1/v2 dans `restoreTable`. Peut nécessiter `z.union` ou `z.discriminatedUnion`. Lire `app/api/monthly-recap/recover/route.ts` pour identifier le contrat exact + 3 tests gated du sprint Lint-Followups qui regression-guard la shape boolean/number.
  - `updateStepBodySchema = z.object({ context, step: z.number().int().positive() })` (probable, à confirmer).

### C. GET query params (si Q2=A)

Créer un helper `parseQuery(request, schema)` dans `lib/api/parse-body.ts` :

```ts
export function parseQuery<T>(request: NextRequest, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const result = schema.safeParse(params)
  if (!result.success) {
    throw new BadRequestError('Query params invalides', result.error.issues)
  }
  return result.data
}
```

Note : `searchParams` retourne uniquement des strings. Les schemas devront utiliser `z.coerce.number()` / `z.coerce.boolean()` pour les types non-string. Pattern miroir du deep-dive `paginationSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) })`.

### D. Client forms (si Q4 ≠ C)

Pour `AddBudgetDialog` + `EditBudgetDialog` (les 2 plus complexes, à migrer ensemble pour partager le balance refine) :

```ts
// lib/schemas/budget.ts (extend)
export function makeBudgetClientSchema(opts: {
  currentBudgetsTotal: number
  totalEstimatedIncome: number
  currentBudgetAmount?: number // pour edit, le montant pré-existant
}) {
  return z
    .object({
      name: z.string().trim().min(2),
      amount: z.coerce.number().positive(), // input HTML number => string
    })
    .superRefine((data, ctx) => {
      const delta = data.amount - (opts.currentBudgetAmount ?? 0)
      const resultingBalance = opts.totalEstimatedIncome - (opts.currentBudgetsTotal + delta)
      if (resultingBalance < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Solde insuffisant (résultat : ${resultingBalance.toFixed(2)}€)`,
          path: ['amount'],
        })
      }
    })
}
```

Le component injecte le schema via `useForm({ resolver: zodResolver(makeBudgetClientSchema({...props})), values: { name: budget?.name ?? '', amount: budget?.estimated_amount ?? 0 } })`. Le decimal-input → comma normalization restera nécessaire (input prop `onChange={(e) => form.setValue('amount_text', e.target.value.replace(',', '.'))}` ou un `Controller` custom).

### E. Tests

Pour chaque nouveau schema, **1-3 cas** dans `lib/schemas/__tests__/<schema>.test.ts` (pattern miroir v1) :

- happy path
- refine fail (si applicable)
- discriminatedUnion miss (si applicable)

Bucket total estimé : +15-25 cas non-gated, total ~170 cas après v2.

### F. Documentation

- Mettre à jour [`CLAUDE.md`](../CLAUDE.md) §11 avec une entrée Sprint Zod-Rollout-v2 (commits + LOC delta + risk callouts si rencontrés).
- Étendre §6 "Validation Zod" si nouveaux patterns émergent (e.g. `parseQuery` helper, `superRefine` cross-field via props).
- Mettre à jour le `EXPECTED_RPCS` count si applicable (probable : aucun changement, le v2 est purement TS).

## Contraintes techniques

- **Lint baseline 183 stable** doit rester (chaque commit `pnpm verify` exit 0).
- **Pas de nouveau `: any`** dans `lib/schemas/**` ni dans les routes migrées.
- **Counter `as unknown as SupabaseClient` = 0** doit rester (régression guard CLAUDE.md §5).
- **Préserver les fallbacks 200-on-error** (`/api/finance/summary`, `/api/profile` GET) — le parseBody ne s'applique qu'au boundary du body, les fallbacks downstream sont inchangés.
- **Préserver les cleanup-attempts CRITIQUES** existants — Lot 4-5 ont annoté in-line les sites à NE PAS toucher (savings/transfer L122/L321/L337 = closed by Sprint Atomicity-Savings ; expenses-real L431 ; auth/session L56 ; recover L306).
- **Réutiliser les schemas v1 quand la shape est identique** — pas de duplication. Si une shape diverge, créer un nouveau schema en justifiant pourquoi.

## Critères de validation

- `pnpm verify` exit 0 à chaque commit.
- `pnpm test:run` : delta +15-25 cas non-gated (170 total estimé).
- Negative greps clean :
  - `Grep "await request.json()" lib/api/finance/ app/api/{auth,groups,monthly-recap}/` (hors process-step1 déjà migré + hors routes qui restent dans le périmètre v3) = 0 hits sur le scope migré.
  - `Grep "typeof.*!==.*'number'.*\|\|.*<= 0" lib/api/finance/` = 0 hits.
  - `Grep "from '@/lib/api/parse-body'" <scope migré>` = nombre attendu de fichiers.
- Smoke browser deferred to user pour les forms migrés (AddBudgetDialog balance refine, etc.).

## Instructions pour Claude Code

- Phase 1 inventaire **obligatoire** (la moitié du périmètre v1 a été invalidé par stale-prompt). Pour chaque route, lire le body parsing actuel + identifier les validations préexistantes plus strictes que les schemas v1 (règle "preserve stricter").
- Découper par domaine (un commit = un schema + son(ses) handler(s)) — cohérent v1.
- Premier commit = closeout des **6 handlers oubliés** (priorité absolue, scope étroit, valide rapidement le pattern).
- Closeout commit = update CLAUDE.md §11 + §6 si nouveaux patterns.
- Re-confirmer chaque arbitrage Q1-Q5 via `AskUserQuestion` AVANT exécution — ne pas présumer du scope, l'audit est probablement encore partiellement stale.

## Out of scope (explicite, suite v1)

- Sprint Tailwind-v4 (CSS-first migration).
- Sprint Supabase-Strict-Types (5 sites monthly-recap avec `RejectExcessProperties`).
- Chantier I6 (extraction logique métier de `complete/route.ts` + `balance` + `auto-balance` + auto-balance reversed RPC→INSERT atomicity).
- OpenAPI / schema-to-docs (R10 audit) — peut être un sprint dédié après v2.
- Migration Money en centimes (int) plutôt qu'euros (decimal) — out of scope, conserver le comportement actuel.
- Sweep final console.log Lot 6 (~334 sites BLOCKED I5 + 112 sites BLOCKED I4).
