# Sprint Cleanup-Legacy + Generic-Audit-v2 — drop dead functions + extend audit to types/enums

## Contexte

Le **Sprint Audit-Functions-v2** ([prompt-00-executive-summary-v7.md](prompt-00-executive-summary-v7.md), livré 2026-05-07) a refermé B1–B3 en 4 commits sur `cleanup` (`eed2f1e → 67f0514`). Pendant l'exécution de B1, **4 fonctions PL/pgSQL legacy non-versionnées** ont été surfacées au premier run de `pnpm db:audit-functions` :

- `check_column_exists` — utilitaire de migration legacy
- `create_recap_snapshot` — remplacée par `lib/database-snapshot.ts` en T4
- `final_verification` — diagnostic post-migration legacy
- `is_monthly_recap_required` — pré-check recap legacy

**Vérifié** : zéro callsite `.rpc()` dans le code app ([lib/database.types.ts](../lib/database.types.ts) les liste uniquement parce que Supabase auto-génère les types depuis `pg_proc`). Capturées verbatim dans [supabase/migrations/20260513000000_capture_legacy_functions.sql](../supabase/migrations/20260513000000_capture_legacy_functions.sql) **comme filet de sécurité** : la capture préserve les bodies en git mais ne change rien en prod.

Cela laisse 2 axes ouverts :

1. **Le filet de capture est devenu permanent par défaut.** Tant que les 4 fonctions ne sont pas DROP'ed en prod, elles continuent à apparaître dans `lib/database.types.ts` (regen via `pnpm db:types`), à occuper de l'espace dans `pg_proc`, et à imposer leur capture sur chaque `db:audit-functions` run. Le pattern A2 (capture-then-drop) attend son **DROP**.

2. **L'audit générique est limité aux fonctions.** B1 ne couvre pas les **types custom**, **enums**, **operators**, **aggregates**, **domains**, **policies**, **indexes** — même problème conceptuel (un objet DB en prod sans trace dans les migrations). Hors-scope explicite de v7 ; aucun cas réel surfacé pour ces catégories, mais on n'en sait rien tant qu'on ne regarde pas.

---

### 🔴 Bloc C1 — DROP the 4 dead legacy functions

**Cause root** : v7 a documenté la dette mais n'a pas fermé le cycle (capture-then-drop). Les 4 fonctions sont confirmées dead code (zéro callsite). Le filet de capture (migration `20260513000000`) est en place — c'est exactement le moment de DROP.

**Fix** : nouvelle migration `<TS>_drop_legacy_functions.sql` qui :
```sql
DROP FUNCTION IF EXISTS public.check_column_exists(text, text);
DROP FUNCTION IF EXISTS public.create_recap_snapshot(uuid, text);
DROP FUNCTION IF EXISTS public.final_verification();
DROP FUNCTION IF EXISTS public.is_monthly_recap_required(uuid, text);
NOTIFY pgrst, 'reload schema';
```

Workflow obligatoire (cf. CLAUDE.md §8 "**Pour capturer rétroactivement…**" — adapté DROP) :
1. `node scripts/apply-sql.mjs supabase/migrations/<TS>_drop_legacy_functions.sql`
2. `pnpm supabase migration repair --status applied <TS>` (sinon prochain `db push` retentera = drift C3 redux)
3. `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql`
4. `pnpm db:check-drift` → exit 0
5. `pnpm db:audit-functions` → 9 fonctions versionnées (4 RPC C3 + 5 A2), 4 fonctions de moins
6. `pnpm db:types` puis vérifier que `lib/database.types.ts` ne mentionne plus les 4 noms
7. `pnpm typecheck` → exit 0 (zéro callsite, donc rien ne casse)

**Critère** :
1. `pnpm db:audit-functions` revient à 9 fonctions (vs 13 aujourd'hui).
2. `pnpm db:check-drift` exit 0 après re-export.
3. `lib/database.types.ts` ne contient plus `check_column_exists` / `create_recap_snapshot` / `final_verification` / `is_monthly_recap_required` (verifier via `grep -c` → 0).
4. `pnpm typecheck && pnpm test:run` clean.
5. Test de récupération documenté : si on doit re-créer une de ces fonctions, le body est dans la migration `20260513000000_capture_legacy_functions.sql` (CREATE OR REPLACE idempotent).

**Hors scope** : modifier les 4 fonctions avant de les DROP. Si on identifie un usage hors-app (cron Supabase, autre service), on ABANDONNE le DROP de cette fonction-là et on documente pourquoi dans le commit message.

---

### 🟠 Bloc C2 — Generic DB object audit (types, enums, operators)

**Cause root** : `db:audit-functions` couvre `pg_proc.prokind='f'`. PostgreSQL a d'autres catégories d'objets schémés que peuvent être créées hors-migration : **types** custom (`pg_type`), **enums** (`pg_type` avec typtype='e'), **operators** (`pg_operator`), **aggregates** (`pg_proc.prokind='a'`), **domains** (`pg_type` avec typtype='d'). Aucun cas réel n'a été surfacé, mais la même logique vaut : un objet DB load-bearing sans trace dans `supabase/migrations/`, c'est le risque A2 sous une autre forme.

**Fix** : nouveau script `scripts/audit-db-objects.mjs` qui interroge **5 catégories** et regrep les migrations :
1. Functions (`pg_proc.prokind IN ('f','a','p')`) — déjà couvert par audit-functions, mais le script ré-énumère pour l'unification.
2. Types composites (`pg_type` avec `typtype='c'` et `typrelid` sans `pg_class.relkind='r'`).
3. Enums (`pg_type.typtype='e'`).
4. Domains (`pg_type.typtype='d'`).
5. Operators (`pg_operator` filtrés sur `oprnamespace = 'public'`).

Pour chacun, regex de présence dans migrations (cf. [scripts/audit-functions.mjs](../scripts/audit-functions.mjs) pour le pattern `escapeRegex` + JOIN-corpus). Output : tableau global + listes par catégorie + `MISSING_FROM_MIGRATIONS` agrégé.

Ajouter à [package.json](../package.json) : `"db:audit-objects": "node scripts/audit-db-objects.mjs"`. **Pas** dans le cron (lourd, ad-hoc), documenté comme audit ad-hoc post-migration majeure.

**Critère** :
1. `pnpm db:audit-objects` exit 0 aujourd'hui (état présumé propre — aucune custom type/enum visible dans le baseline actuel).
2. Si exit 1 : suivre le pattern v7 / B1 — inspecter, décider capture vs drop, documenter dans CLAUDE.md §7.
3. Documenter dans CLAUDE.md §8 que `db:audit-objects` doit être lancé après toute migration ajoutant un `CREATE TYPE` / `CREATE OPERATOR` / etc.
4. Étendre [.github/workflows/db-drift-pr.yml](../.github/workflows/db-drift-pr.yml) ? Optionnel — `audit-objects` est plus lourd, mais le path filter `supabase/migrations/**` le rendrait acceptable. Décider après avoir mesuré le runtime.

**Hors scope** : auditer **les RLS policies par table** (déjà couvert par `db:check-drift` qui compare le baseline complet). Auditer **les indexes** (idem). Auditer **les schemas non-`public`** (`auth`, `storage`, `extensions`) — Supabase-managed, pas user code.

---

### 🟡 Bloc C3 — Validate B3 PR-time gate end-to-end (low-risk)

**Cause root** : [.github/workflows/db-drift-pr.yml](../.github/workflows/db-drift-pr.yml) (Sprint Audit-Functions-v2 / B3) a été commité mais jamais déclenché par une vraie PR. La vérification "test négatif" reste manuelle (cf. v7 "ouvrir une PR test qui drop une trigger function du baseline").

**Fix** : ouvrir une PR test depuis une branche éphémère qui modifie [supabase/migrations/20260101000000_remote_schema.sql](../supabase/migrations/20260101000000_remote_schema.sql) — par exemple en supprimant temporairement un `CREATE TRIGGER` du baseline. **Pas** d'application en prod (modif baseline-only). Observer :
1. Le workflow `DB drift check (PR)` se déclenche sur la PR.
2. `db:check-drift` exit 1 (baseline ↔ prod divergent).
3. Le PR check est rouge dans l'UI GitHub.
4. Reverter le commit baseline-modify, observer le check repasser vert.
5. Fermer la PR sans merge.

**Critère** :
1. Workflow PR-time observé une fois.
2. Si le workflow ne s'est pas déclenché sur le path filter (`supabase/migrations/**`), debug le YAML.
3. Si le secret `SUPABASE_ACCESS_TOKEN` n'est pas accessible depuis un PR (privilégies GitHub Actions sur `pull_request` vs `pull_request_target`), documenter dans `db-drift-pr.yml` et dans CLAUDE.md.

**Hors scope** : créer un workflow `pull_request_target` pour les PR depuis forks. Le repo est privé pour l'instant, donc `pull_request` suffit.

---

## Ordre d'exécution

1. **C1 d'abord** — DROP the 4 functions, valider `db:audit-functions` exit 0 avec 9. Le DROP est plus engageant que C2/C3 ; à valider avant d'extension du périmètre. 1 commit (~80 LOC : 1 migration + baseline re-export + CLAUDE.md).
2. **C2** — script `audit-db-objects.mjs`. Indépendant de C1 conceptuellement. 1 commit (~150 LOC).
3. **C3** — validation manuelle du workflow B3. Pas de commit nécessaire (test PR fermée sans merge), juste un screenshot ou mention dans CLAUDE.md §11.

**2-3 commits attendus sur `cleanup`.**

## Critères globaux

- `pnpm typecheck && pnpm lint:check && pnpm test:run` clean.
- `pnpm db:check-drift` exit 0.
- `pnpm db:check-rpcs` exit 0.
- `pnpm db:check-functions` exit 0.
- `pnpm db:audit-functions` exit 0 (avec 9 fonctions au lieu de 13).
- `pnpm db:audit-objects` exit 0 (nouveau).
- `SUPABASE_TRIGGER_TESTS=1 pnpm test:run` 4/4 verts.
- Workflow PR-time observé déclenché au moins une fois.
- CLAUDE.md mis à jour (§3 commandes, §7 fait, §8 do, §11 roadmap).

## Risques

1. **C1 — fonction supposément dead utilisée par un cron Supabase**. Mitigation : avant DROP, lancer une recherche "all references" complète : code app (déjà fait, zéro), workflows GitHub (`grep -r "rpc.*<func>"` dans `.github/`), Supabase Dashboard (cron jobs / scheduled functions / Edge Functions / triggers). Si trouvé, abandonner le DROP de cette fonction et documenter.

2. **C1 — drift C3 redux**. Si on oublie `migration repair --status applied`, le prochain `db push` retentera la migration DROP et échouera (les fonctions n'existent plus en prod). Discipline : suivre les 7 étapes du workflow obligatoire dans l'ordre.

3. **C2 — false positives sur les types Supabase-managed**. `pg_type` contient des centaines d'entrées (les row types, les array types implicites, etc.). Filtres clés à vérifier : `n.nspname='public'`, `t.typtype IN ('c','e','d')` pour types/enums/domains, **exclure** les types implicites de table (`typtype='c' AND typrelid` qui pointe vers une vraie table). Tester le script avant de le commiter pour s'assurer qu'il ne floode pas.

3. **C3 — `pull_request` vs `pull_request_target` pour les secrets**. Sur GitHub, `pull_request` events from external forks **n'ont pas accès aux secrets**. Le repo est privé donc OK pour l'instant. Si à un moment le repo passe public, basculer le YAML vers `pull_request_target` + filtre auteur (cf. risk #4 de v7).

## Hors-scope

- Sprint 1 (Prettier/Husky/CI/ESLint Next 16) — sprint dédié.
- Lint cleanup global (~125 errors) — progressif, hors-sprint (cf. CLAUDE.md §11).
- I4 god file (`lib/financial-calculations.ts`) — chantier dédié.
- I5 process-step1 extraction — chantier dédié.
- Console.log cleanup (1331 occurrences) — chantier dédié.
- Zod rollout — chantier dédié.
- Audit indexes / RLS policies / non-public schemas — déjà couvert par `db:check-drift` (baseline complet).
- Modification des RPC C3 — corrections via nouvelles migrations seulement.

## Push gate (rappel)

C1 fait un DROP en prod via `apply-sql.mjs` — c'est un changement schéma irréversible (sauf à re-appliquer la migration `20260513000000_capture_legacy_functions.sql` qui contient les bodies). **Confirmation utilisateur obligatoire** avant `apply-sql.mjs` du DROP, et **encore une** avant le `migration repair`. Documenter le DROP dans le commit message avec mention explicite du recovery path.

C2 / C3 ne touchent rien en prod (script lecture seule + workflow YAML).
