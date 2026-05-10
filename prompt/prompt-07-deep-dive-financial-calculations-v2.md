# Refactor I4 — suite (post-livraison)

## Contexte

Le chantier I4 a été livré 2026-05-11 en 9 commits sur `cleanup` (commits `b0cf57d` → `112a529`). L'ex-god file [lib/financial-calculations.ts](lib/financial-calculations.ts) (1069 LOC, 11 exports) a été splitté en 8 modules sous [lib/finance/](lib/finance/) puis supprimé. Détails dans [CLAUDE.md §11 entry "Sprint Refactor-I4"](CLAUDE.md#11-roadmap) et le plan figé `C:\Users\gille\.claude\plans\refactor-i4-vast-flask.md`.

Ce qui a été **explicitement déféré** au moment de la livraison :

1. **Tests gated `SUPABASE_FINANCE_TESTS=1` pour `_loadFinancialData`** — 4 fichiers de tests gated proposés au plan (income-compensation 4 cas + rav-persistence 4 cas + financial-data 6 cas + budget-savings-detail 3 cas = 17 cas). Aucun n'a été créé : la priorité du livrable I4 était la séparation propre + Lot 2 console-cleanup ; l'infra de seed (~120 LOC : profile + estimated/real incomes + estimated/real expenses + bank_balances + group_contributions + piggy_bank + cleanup cascade en `afterAll`) n'amortit que sur ≥3 suites consommatrices.

2. **Audit `lib/contribution-calculator.ts` (138 LOC)** — flagué hors scope dans [docs/audit/07-deep-dive-financial-calculations.md](docs/audit/07-deep-dive-financial-calculations.md) et le plan I4 comme "possible logical overlap with `calculateIncomeCompensation`". Aucune verification n'a été faite.

3. **Alignement `lib/financial-logger.ts` (288 LOC) avec `lib/logger.ts`** — couplage explicite I4 mentionné dans CLAUDE.md §6 Logs ("alignement avec lib/logger.ts deferred I4"). Maintenant que I4 est clos, cette dette devient adressable. 1 consumer reste : `lib/api/finance/income-real.ts` (les `console.*` directs ont été migrés au Lot 4e mais les call sites `FinancialLogger.startOperation` / `success` / `databaseError` / `financialCalculation` restent intacts).

4. **Type smell mineur dans `_loadFinancialData`** : la ligne 45 utilise `(groupIdOrU as string)` parce que le narrow `'profile_id' in filter` ne discrimine pas proprement la `ContextFilter` union (le `?: never` côté second variant fait que `in` retourne true même quand le champ n'existe pas). C'est une dette de typage 1-ligne sans impact runtime.

L'objectif de cette session est de fermer les 3 premiers items dans l'ordre de priorité décroissante. Le 4e est trivial et peut être bundled au passage.

---

## Objectif 1 (priorité haute) — Gated tests pour `_loadFinancialData` et `saveRavToDatabase`

### Pourquoi maintenant

Le risque R2 du plan I4 ("profile/group factorization 80% diff") n'est aujourd'hui validé que par :
- 19 tests pure-unit sur `calc-rtl.ts` (formules en aval — pinent le format RAV mais pas l'orchestration).
- 5 tests unit-mock sur `snapshots.ts` (dispatcher, pas DB-réel).
- 3 tests gated `SUPABASE_API_TESTS=1` dans [lib/__tests__/api-regressions.test.ts](lib/__tests__/api-regressions.test.ts) qui exercent `getProfileFinancialData` sur 1 fixture profile (couverture partielle, profile-only, pas le path group).

Le path `getGroupFinancialData` n'est pas exercé par un test gated. Si une régression silencieuse touche le branch group (`groupContributions` fetch, formule `calculateRemainingToLiveGroup`, salary-skip), aucun filet ne le détectera avant l'UI.

### Livrables

Créer **un seul nouveau fichier** : [lib/finance/__tests__/financial-data.test.ts](lib/finance/__tests__/financial-data.test.ts), gated `SUPABASE_FINANCE_TESTS=1`. Pattern miroir [lib/__tests__/api-regressions.test.ts](lib/__tests__/api-regressions.test.ts) (dynamic-import-in-beforeAll + cleanup cascade en `afterAll`).

**Fixture seed (~80 LOC dans `beforeAll`)** :
- 1 profile + 1 group + ajoute le profile au group (`profile.group_id = group.id`)
- Profile-only : `profiles.salary = 1500`, 2 `estimated_incomes` (montants 800 + 200), 1 `real_income_entry` lié à l'estimé 800 (montant 750), 1 `real_income_entry` exceptional (montant 100, `estimated_income_id = null`), 2 `estimated_budgets` (200 + 300), 1 `real_expense` lié au budget 200 (montant 150), 1 `real_expense` exceptional (montant 80), `bank_balances.balance = 500`, `piggy_bank.amount = 50`
- Group-only : 1 `estimated_income` (montant 1000), 1 `real_income_entry` lié (montant 1000), 1 `estimated_budget` (montant 600), 1 `real_expense` lié (montant 400), `bank_balances.balance = 1200`, `group_contributions` [contribution_amount: 750] (1 row, le profile contribue à son group), `piggy_bank.amount = 100`

**Cleanup cascade en `afterAll`** : `group_contributions` → `piggy_bank` (group, profile) → `bank_balances` (group, profile) → `real_expenses` (group, profile) → `real_income_entries` (group, profile) → `estimated_budgets` (group, profile) → `estimated_incomes` (group, profile) → `profiles` → `groups` → `auth.admin.deleteUser`.

**6 cas de test** :
1. **Profile : valeurs golden vs fixture math** — calculer manuellement les 7 champs `FinancialData` à partir du seed et asserter `expect(data).toEqual(GOLDEN_PROFILE)`. Inclut le path salary-add (incomeContribution = 750 + 1500 = 2250 puisque l'estimé 800 est utilisé donc on prend le réel 750, et l'estimé 200 non-utilisé donne +200, total 950 + salary 1500).
2. **Group : valeurs golden vs fixture math** — idem. Inclut le terme `totalProfileContributions = 750` ajouté au RAV group.
3. **Profile sans estimés** — créer une seed minimaliste (juste `bank_balances`), asserter que `getProfileFinancialData` retourne `availableBalance = bankBalance`, autres à 0.
4. **Group sans estimés** — idem version group, sans `group_contributions`.
5. **Fail-soft `EMPTY_FINANCIAL_DATA`** — passer un `profileId` qui n'existe pas (uuid random), vérifier que la fonction retourne `EMPTY_FINANCIAL_DATA` avec les 7 champs à 0 (la fonction ne throw jamais). Idem group.
6. **`saveRavToDatabase` round-trip** — appeler `getProfileFinancialData` (qui appelle `saveRavToDatabase` en interne L211), puis lire `bank_balances.current_remaining_to_live` directement et vérifier qu'il match `data.remainingToLive`. Pin le contrat de persistance.

### Conditions de succès

- `pnpm test:run` reste vert non-gated (les nouveaux cas skip sans env var)
- `SUPABASE_FINANCE_TESTS=1 pnpm test:run lib/finance/__tests__/financial-data.test.ts` exit 0 avec 6/6 passed
- Cleanup cascade vérifié : après le `afterAll`, `select * from profiles where email like '%fixture-%@popoth.test'` doit retourner 0 row (manuel, pas dans le test). Le seeded user doit être supprimé via `admin.auth.admin.deleteUser`.
- Aucun changement de code applicatif, juste un nouveau test file.
- Mise à jour CLAUDE.md §9 Tests : ajouter une bullet pour `SUPABASE_FINANCE_TESTS=1` dans la liste "Tests gated".

---

## Objectif 2 (priorité moyenne) — Audit `lib/contribution-calculator.ts` overlap

### Pourquoi maintenant

Le fichier (138 LOC) a été flagué dans [docs/audit/07-deep-dive-financial-calculations.md](docs/audit/07-deep-dive-financial-calculations.md) comme un possible doublon de `calculateIncomeCompensation`. Le plan I4 l'a explicitement laissé hors scope ("flagged for follow-up sprint, not touched here"). Maintenant que `calculateIncomeCompensation` vit proprement sous `lib/finance/income-compensation.ts`, l'audit overlap est faisable sans refactoring concurrent.

### Démarche

**Phase 1 — Inventaire** (1 Explore agent, focus serré) :
- Lire intégralement `lib/contribution-calculator.ts`
- Identifier les fonctions exportées + leur signature
- Comparer logique métier vs `lib/finance/income-compensation.ts:calculateIncomeCompensation` (la logique : revenu estimé non utilisé → +estimé au RAV, revenu estimé utilisé → +réel au RAV)
- Lister les consommateurs : `grep -rn "from '@/lib/contribution-calculator'" --include="*.ts" --include="*.tsx"`

**Phase 2 — Décision** (AskUserQuestion) :
3 options selon l'inventaire :
- **(a) Doublon strict** : delete `lib/contribution-calculator.ts`, migrer les consommateurs vers `calculateIncomeCompensation` du même module — fait dans 1-2 commits.
- **(b) Sémantique différente** : c'est une autre logique métier (e.g. répartition des contributions de groupe entre membres), garder mais documenter explicitement la différence dans le JSDoc. Optionnellement, migrer sous `lib/finance/group-contributions.ts` pour cohérence du namespace.
- **(c) Partiellement chevauchant** : extraire le helper commun, garder les surfaces distinctes.

### Conditions de succès

Selon décision phase 2 :
- (a) : `git rm lib/contribution-calculator.ts` + 0 consumer reste.
- (b) : JSDoc enrichi sur les 2 fonctions concernées + section ajoutée à CLAUDE.md §5 architecture critique distinguant les 2 calculs.
- (c) : helper extrait sous `lib/finance/`, les 2 modules consument.

Dans tous les cas : `pnpm verify` exit 0 + greps négatifs propres.

---

## Objectif 3 (priorité moyenne) — Alignement `lib/financial-logger.ts` ↔ `lib/logger.ts`

### Pourquoi maintenant

`lib/financial-logger.ts` (288 LOC) est un logger domain-specific avec une classe `FinancialLogger` exposant des méthodes typées (`startOperation`, `success`, `databaseError`, `financialCalculation`, `validationError`, etc.). Il a 1 seul consumer : `lib/api/finance/income-real.ts` qui appelle 6-8 méthodes au cours du flow CRUD income.

Problèmes :
- **Doublon de mécanique** avec `lib/logger.ts` (les deux loggent vers `console.*`).
- **Non gated** par `LOG_LEVEL` — `FinancialLogger` log toujours, sans respect du gate prod-quiet établi au Lot 1.
- **Strip prod cassé** : `next.config.js` `compiler.removeConsole` strip les `console.log/info/debug`, donc les méthodes `FinancialLogger` qui appellent `console.log` en interne sont silently strippées en prod — comportement non-intentionnel (les méthodes nommées `success` et `financialCalculation` étaient probablement censées rester en prod pour audit).
- **0 test** sur `FinancialLogger` (vs 11 tests sur `lib/logger.ts`).

### Options

**Option α — Wrap autour de `lib/logger.ts`** : refactorer `FinancialLogger` pour que toutes ses méthodes appellent `logger.info`/`logger.warn`/`logger.error`/`logger.debug` au lieu de `console.*`. Préserve l'API typée pour le consumer mais gagne le gating + le strip prod cohérent. ~1 jour.

**Option β — Suppression** : `FinancialLogger` est un wrapper avec ~6 méthodes ; income-real.ts pourrait appeler directement `logger.info('[Income] startOperation', ctx)` etc. Le code-side perd 288 LOC, gagne 1 dépendance en moins. ~½ jour de migration des call sites.

**Option γ — Statu quo + gating** : ajouter un `LOG_LEVEL` check au top de chaque méthode `FinancialLogger`, cherry-pick le gating sans refactor structurel. Conservatif, ~½ jour.

User à arbitrer en Phase 1 via AskUserQuestion.

### Conditions de succès

- Selon option choisie : `lib/financial-logger.ts` aligné, supprimé, ou simplement gated.
- Si conservé : ajouter `lib/__tests__/financial-logger.test.ts` (pattern miroir `logger.test.ts`, 5-8 cas pure-unit).
- Aucune régression sur le consumer `income-real.ts` — son flow CRUD (POST/PUT/DELETE) doit produire les mêmes effets observables (peut être validé via `SUPABASE_API_TESTS=1` regression-guard ou smoke browser).
- ESLint glob `'lib/financial-logger.ts'` ajouté à la liste per-file `no-console: 'error'` si l'option choisie élimine les `console.*` directs.

---

## Objectif 4 (bundlable, trivial) — Nettoyer le `as string` dans `_loadFinancialData`

[lib/finance/financial-data.ts:45](lib/finance/financial-data.ts#L45) :

```ts
const ownerId: string = isProfile ? profileIdOrU : (groupIdOrU as string)
```

Le cast `(groupIdOrU as string)` existe parce que `resolveContextIds` retourne `string | undefined` pour chacun des deux IDs (l'invariant "exactement un est défini" est runtime, pas type-level). Options :

- Refactorer `resolveContextIds` pour retourner un tagged union `{kind: 'profile', id: string} | {kind: 'group', id: string}` au lieu d'un objet `{profile_id?, group_id?}`. Ça propage le narrow proprement aux call sites. Impact : 1 site supplémentaire à toucher dans `lib/finance/income-compensation.ts:30-32` (qui appelle `resolveContextIds` aussi) + tests (les types de fixtures n'utilisent pas `ContextIds` directement, donc safe).

- Ou : ajouter une assertion `if (!ownerId) throw new Error('unreachable')` après le ternaire pour garantir la non-nullité au type-checker, sans cast. Plus simple, plus défensive, 0 changement de signature.

Bundled à un autre objectif de cette session si possible — sinon, garder pour plus tard.

---

## Workflow général

1. **Phase 1** — explorer en parallèle 1-2 fichiers cible (Explore agents : `lib/contribution-calculator.ts` + `lib/financial-logger.ts`).
2. **AskUserQuestion** sur Objectif 2 (a/b/c) et Objectif 3 (α/β/γ).
3. **Plan Phase 2** — exécuter dans l'ordre 1 → 2 → 3 → 4 (4 bundlable au plus tôt).
4. **Verif après chaque commit** : `pnpm typecheck` + `pnpm test:run` + `pnpm lint:check` + `pnpm format:check`.
5. **Closeout** — mettre à jour CLAUDE.md (§5, §6, §9, §11) + plan file `C:\Users\gille\.claude\plans\` au pattern existant.

## Hors scope

- **Smoke browser de l'I4 livré** — c'est une tâche utilisateur (login → /dashboard → comparer RAV affiché vs git checkout pre-I4 sur un seed identique), pas une tâche Claude.
- **Chantier I5** (`process-step1` god route) — strict scope séparé.
- **Migration des 18 importers du barrel `@/lib/finance` vers les sous-modules précis** — gain marginal (tree-shaking déjà OK avec barrel exports), pas nécessaire.
