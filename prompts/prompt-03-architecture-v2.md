# Prompt — Sprint Refactor-Architecture v2 (cleanup + extension)

## Contexte

Le Sprint Refactor-Architecture (livré 2026-05-08, 5 commits `35c86e7 → 3601b28`) a unifié l'API sous `/api/finance/*` avec un système d'aliases rétro-compatibles taggés `Deprecation: true`. Le prompt initial demandait **1 sprint d'observation** avant de retirer ces aliases.

Ce sprint v2 a deux volets indépendants :

1. **Cleanup des deprecated** : retirer les wrappers `withDeprecation` et les anciens chemins `/api/finances/*`, `/api/financial/*`, `/api/budgets`, `/api/incomes`. Vérifier qu'aucun consumer externe (test, doc, hook oublié, frontend statique) ne dépend encore d'un ancien chemin.
2. **Ambiguïtés résiduelles surfacées en v1** : trois découvertes faites pendant le sprint v1 ont été préservées telles quelles (zero-risk migration) mais valent un nettoyage maintenant que la voie est claire :
   - `/api/finance/budgets` GET vs `/api/finance/budgets/estimated` GET — handlers différents pour la même ressource (estimated_budgets), surface client utilise uniquement la 2e variante en lecture.
   - `/api/finance/summary` (ex `/api/financial/dashboard`) vs `/api/finance/dashboard` — 2 routes "dashboard" coexistent, retournent des shapes différentes.
   - Logique métier dupliquée entre `lib/api/finance/dashboard.ts` (recalcul direct via Supabase) et `lib/api/finance/summary.ts` (réutilise `getProfileFinancialData` / `getGroupFinancialData`).

Optionnellement, un 3e volet : **étendre le pattern `withDeprecation` aux autres surfaces** (`/api/savings/*`, `/api/groups/*`, `/api/profile`) si tu juges la cohérence valable.

## Pré-requis avant exécution

- Confirmer qu'au moins **1 deploy production** a tourné depuis la livraison du Sprint Refactor-Architecture (cleanup) — les telemetries Vercel ou logs Supabase doivent montrer 0 hit sur les anciens paths après la migration des hooks. **Sinon, attendre.**
- `git log --since='2026-05-08' --oneline cleanup` pour confirmer qu'aucun nouveau code n'a réintroduit un appel à `/api/finances/*` etc.

## Objectifs précis

### Volet A — Cleanup deprecated (obligatoire)

1. **Inventaire des consumers résiduels** :
   ```
   grep -rn "/api/finances/" --include="*.ts" --include="*.tsx" --include="*.md" .
   grep -rn "/api/financial/" --include="*.ts" --include="*.tsx" --include="*.md" .
   grep -rn "/api/budgets" --include="*.ts" --include="*.tsx" --include="*.md" .
   grep -rn "/api/incomes" --include="*.ts" --include="*.tsx" --include="*.md" .
   ```
   Toute occurrence dans `hooks/`, `components/`, `app/` (hors `app/api/`) doit être migrée AVANT de supprimer les routes.
   Les occurrences dans `docs/`, `prompts/`, `CLAUDE.md` sont OK (historique).

2. **Supprimer les anciennes routes** :
   - `rm -rf app/api/finances/`
   - `rm -rf app/api/financial/`
   - `rm app/api/budgets/route.ts && rmdir app/api/budgets`
   - `rm app/api/incomes/route.ts && rmdir app/api/incomes`

3. **Supprimer le helper** : `lib/api/with-deprecation.ts` n'est plus utilisé. Vérifier via `grep -rn "with-deprecation"` puis supprimer.

4. **Verif** :
   - `pnpm typecheck` exit 0
   - `pnpm lint:check` exit 0
   - `pnpm build` exit 0 — vérifier dans la liste de routes que **les anciens paths ont disparu** mais que les nouveaux `/api/finance/*` sont toujours là.
   - Manuel : `curl -i http://localhost:3000/api/finances/dashboard` → 404. `curl -i http://localhost:3000/api/finance/dashboard` → 401 (pas de cookie session) — pas de header `Deprecation: true` non plus puisque la route canonique ne le porte pas.

5. **Commit** : `chore(api): remove deprecated /api/{finances,financial,budgets,incomes}/* aliases`.

### Volet B — Ambiguïtés résiduelles (à arbitrer)

Pour chaque point, lire d'abord les 2 fichiers concernés, puis **demander arbitrage utilisateur via AskUserQuestion** avant de coder. Trois options génériques par point :
1. **Consolider** : un seul handler, supprimer le doublon (breaking change minimum, changement de surface API).
2. **Garder 2 paths distincts** : status quo, juste documenter la dualité dans CLAUDE.md.
3. **Renommer pour dissiper l'ambiguïté** : ex. `/api/finance/budgets/cumulated-savings` au lieu de `/api/finance/budgets/estimated`.

#### B.1 — `/api/finance/budgets` GET vs `/api/finance/budgets/estimated` GET

- [`lib/api/finance/budgets.ts`](../lib/api/finance/budgets.ts) GET : filtre `estimated_budgets` par `profile_id` ou `group_id` avec `is null` sur l'autre. Retourne `{ budgets: [...] }`.
- [`lib/api/finance/budgets-estimated.ts`](../lib/api/finance/budgets-estimated.ts) GET : filtre `estimated_budgets` par `profile_id` (ou `group_id` via param `group=true`), pas de `is null`, sélectionne `cumulated_savings` + `last_savings_update` en plus, calcule `spent_this_month` à partir de `real_expenses`. Retourne `{ estimated_budgets: [...] }` avec champ supplémentaire.

Hooks consumer-side :
- [`hooks/useBudgets.ts`](../hooks/useBudgets.ts) — utilise `/api/finance/budgets/estimated` pour read (line 56), `/api/finance/budgets` pour POST/PUT/DELETE (lines 90, 133, 174).

**Donc** : la GET sur `/api/finance/budgets` n'a aucun consumer applicatif. À supprimer ? (Ou garder comme "lite version" sans les calculs de spent_this_month si on découvre un usage externe.)

Pour valider : `grep -rn "fetch.*'/api/finance/budgets'" .` (avec quotes terminales — pas le préfixe `/api/finance/budgets/estimated`).

#### B.2 — `/api/finance/dashboard` vs `/api/finance/summary`

- [`lib/api/finance/dashboard.ts`](../lib/api/finance/dashboard.ts) GET (456 LOC) : assemble manuellement le breakdown détaillé (estimated_budgets + spending par budget + recent_expenses + monthly_summary) en interrogeant directement Supabase. Réutilise `getProfileFinancialData` / `getGroupFinancialData` pour `availableBalance`, `totalRealIncome`, `totalRealExpenses`, `remainingToLive`. Retourne `{ dashboard: FinancialDashboardData }`.
- [`lib/api/finance/summary.ts`](../lib/api/finance/summary.ts) GET (141 LOC) : appelle directement `getProfileFinancialData` / `getGroupFinancialData` + `getRavFromDatabase` pour overrider RAV avec la valeur persistée. Retourne `{ data: FinancialData, context, timestamp }`.

Hooks consumer-side :
- `useFinancialData.ts` — `/api/finance/summary`
- ⚠️ Pas de hook applicatif pour `/api/finance/dashboard`. Vérifier qui consomme — est-ce que les hooks ou pages utilisent les types `FinancialDashboardData` ou son shape ?

Si `/api/finance/dashboard` n'a pas de consumer non plus, c'est aussi un candidat à la suppression. Ou alors il y a un consumer caché (page server-side, cron, etc.) que la première exploration n'a pas vu.

**Action** : `grep -rn "/api/finance/dashboard\b" --include='*.ts' --include='*.tsx' .` puis arbitrer.

#### B.3 — Duplication logique métier entre dashboard.ts et summary.ts

Si les volets B.1 et B.2 résolvent les ambiguïtés (suppression des handlers sans consumer), B.3 disparaît automatiquement. Sinon, il y a une opportunité de factorisation : `dashboard.ts` réutilise déjà `getProfileFinancialData` / `getGroupFinancialData` et fait un travail supplémentaire (breakdown UI). Une approche serait :
- `summary.ts` reste tel quel (raw FinancialData).
- `dashboard.ts` réutilise `summary.ts` interne + ajoute le breakdown UI.

Pas obligatoire — à arbitrer selon le résultat de B.1/B.2.

### Volet C — Extension du pattern (optionnel)

Étendre le pattern `withDeprecation` aux autres surfaces API qui ne sont pas sous `/api/finance/` :
- `/api/savings/data`, `/api/savings/transfer`
- `/api/groups`, `/api/groups/[id]`, `/api/groups/[id]/members`, `/api/groups/contributions`, `/api/groups/search`
- `/api/profile`

Ces routes ne sont pas incohérentes (déjà uniformes) — l'extension aurait surtout un intérêt si on prévoit de les renommer dans un futur sprint. **Sans plan de rename, skip ce volet** (pas d'extraction sans bénéfice).

Si l'utilisateur décide d'étendre : suivre exactement le même pattern que v1 — extraire les handlers en `lib/api/<scope>/<route>.ts`, créer les nouveaux paths sous `/api/<new-namespace>/`, wrapper les anciens. Mais le sprint v1 a déjà introduit `lib/api/finance/` ; faut-il `lib/api/savings/`, `lib/api/groups/`, `lib/api/profile/`, ou tout regrouper ?

## Fichiers à analyser en priorité

- [`app/api/finances/`](../app/api/finances/), [`app/api/financial/`](../app/api/financial/), [`app/api/budgets/`](../app/api/budgets/), [`app/api/incomes/`](../app/api/incomes/) — tout à supprimer (volet A).
- [`lib/api/with-deprecation.ts`](../lib/api/with-deprecation.ts) — à supprimer (volet A).
- [`lib/api/finance/budgets.ts`](../lib/api/finance/budgets.ts) (GET) vs [`lib/api/finance/budgets-estimated.ts`](../lib/api/finance/budgets-estimated.ts) (GET) — volet B.1.
- [`lib/api/finance/dashboard.ts`](../lib/api/finance/dashboard.ts) vs [`lib/api/finance/summary.ts`](../lib/api/finance/summary.ts) — volets B.2 et B.3.
- `hooks/use*` — consumer-side, déjà migrés en v1 mais à reverifier.

## Contraintes techniques

- Aucun changement de comportement runtime sur les paths conservés.
- Format `{ data: T } | { error: string }` préservé.
- Pas de TanStack Query, Zod, logger custom dans ce sprint.
- Conserver les `console.*` existants (chantier I8 séparé).
- `pnpm verify` doit passer en fin de sprint.

## Critères de validation

- `grep -rn "/api/(finances|financial|budgets|incomes)" --include='*.ts' --include='*.tsx' --exclude-dir=docs --exclude-dir=prompts .` ne retourne plus rien (les anciens chemins ne sont ni définis, ni consommés).
- `lib/api/with-deprecation.ts` n'existe plus, `grep -rn "withDeprecation" .` retourne 0 (hors docs/prompts).
- `pnpm build` liste **uniquement** `/api/finance/**` parmi les paths finance.
- Après cleanup, le diff de routes au build show nets minus les 13 anciens paths.
- (Volet B) Si arbitré : 1 ou 2 handlers supprimés en plus, README.md mis à jour pour expliciter que `/api/finance/dashboard` est l'endpoint UI complet et `/api/finance/summary` le résumé numérique brut.

## Découpage en commits

1. `chore(api): remove deprecated /api/{finances,financial,budgets,incomes}/* aliases`
2. `chore(api): remove withDeprecation helper (no remaining wrappers)`
3. (si B.1 résolu) `refactor(api): drop unused /api/finance/budgets GET handler`
4. (si B.2 résolu) `refactor(api): consolidate /api/finance/dashboard vs summary`
5. (si C exécuté) un ou plusieurs commits selon scope.

## Plan de vérification end-to-end

À la fin :
- `pnpm verify` exit 0
- Manuel : login → dashboard → ouverture du modal → ajout d'une dépense → ouverture monthly-recap step1 → équilibrage. Le flow complet doit marcher sans 404 ni 500.
- `pnpm dev` + DevTools Network tab : aucun appel à un ancien path. Tous les fetch vers `/api/finance/**`.

## Notes pour Claude Code

- **Lire en premier** : `CLAUDE.md` §11 (roadmap) + ce prompt + le commit message de `2e00339` (Sprint Refactor-Architecture v1).
- **Sprint Hygiène-Code-v2 a établi le pattern** : un sprint d'observation avant cleanup. Si l'utilisateur valide qu'il n'y a pas eu de hit sur les anciens paths en prod, le cleanup est safe.
- **Si un consumer externe est trouvé** (script CI, doc opsec, frontend séparé), ne pas supprimer la route ; signaler à l'utilisateur et arbitrer (rétro-migration vs garder l'alias 1 sprint de plus).
