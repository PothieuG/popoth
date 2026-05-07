# Sprint Audit-Functions-v2 — generic function audit + trigger behavior coverage

## Contexte

Le **Sprint Audit-Triggers** ([prompt-00-executive-summary-v6.md](prompt-00-executive-summary-v6.md), livré 2026-05-07) a refermé A1–A4 en 6 commits sur `cleanup` (`f747e98 → b5c1cfb`). Pendant l'exécution de A2, **une 5ème fonction non-versionnée a été découverte par accident** : `calculate_group_contributions` (~80 LOC, core métier), appelée via `PERFORM` par 2 des 3 trigger functions qu'on capturait. Sans cette découverte fortuite (faite parce qu'on a lu le body des wrappers), elle serait restée invisible — et `pnpm db:check-functions` aurait été vert tout en laissant un trou béant.

Cela soulève **3 axes non-roadmappés** que ce sprint vient refermer :

1. **L'inventaire est manuel.** [scripts/dump-functions.sql](../scripts/dump-functions.sql) et [scripts/check-trigger-functions.mjs](../scripts/check-trigger-functions.mjs) pinnent une liste **hardcodée** de 4-5 noms. Si une autre fonction `public.*` non-versionnée existe (ou apparaît plus tard via un trigger Supabase Studio mal documenté), on ne la trouvera qu'en relisant manuellement les migrations vs `pg_proc`. Le risque est exactement celui de A2 : une fonction load-bearing sans trace dans le repo.

2. **On vérifie l'existence, pas le comportement.** A3 (`db:check-functions`) confirme que les 4 fonctions custom sont dans `pg_proc`. Mais si quelqu'un fait un `CREATE OR REPLACE FUNCTION trigger_recalculate_contributions() AS 'BEGIN RETURN NEW; END;'`, le check passera vert tout en cassant la logique d'auto-création des `group_contributions`. **Le test RLS R6 dépend de ce comportement** mais ne valide pas explicitement la chaîne trigger → fonction → INSERT.

3. **Drift detection est weekly + manuel.** [.github/workflows/db-drift-check.yml](../.github/workflows/db-drift-check.yml) tourne le lundi 08:00 UTC + on-demand. Une migration buggée mergée le mardi reste invisible 6 jours. Un PR-time gate fermerait ça.

L'inventaire post-A2 est dans [docs/db/SCHEMA.md](../docs/db/SCHEMA.md) section "Inventory" + [supabase/migrations/20260512000000_capture_trigger_functions.sql](../supabase/migrations/20260512000000_capture_trigger_functions.sql).

---

### 🔴 Bloc B1 — Generic public function audit (catches the next calculate_group_contributions)

**Cause root** : la liste de fonctions à vérifier est codée en dur dans [scripts/dump-functions.sql](../scripts/dump-functions.sql) et [scripts/check-trigger-functions.mjs:32-37](../scripts/check-trigger-functions.mjs). Une fonction non-listée échappe à tous les contrôles. C'est exactement comme ça que `calculate_group_contributions` aurait pu rester cachée si A2 n'avait pas lu les bodies des wrappers.

**Fix** : nouveau script `scripts/audit-functions.mjs` qui :
1. Liste TOUTES les fonctions `public.*` via `pg_proc` (filtre `prokind = 'f'`, exclut les RPC C3 connues + boilerplate canonique).
2. Grep `supabase/migrations/*.sql` pour `CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(public\.)?<proname>\b`.
3. Affiche un tableau : `{ name, in_pg_proc: true, in_migrations: bool }` + un summary `MISSING_FROM_MIGRATIONS: [...]`.
4. Exit 0 si toutes les fonctions custom sont versionnées, exit 1 sinon.

Ajouter à [package.json](../package.json) : `"db:audit-functions": "node scripts/audit-functions.mjs"`. **Pas** intégré au cron weekly (c'est plus lourd que `check-functions`), mais documenté comme audit ad-hoc à relancer après chaque ajout de fonction.

**Critère** :
1. `pnpm db:audit-functions` exit 0 aujourd'hui (les 5 fonctions A2 + les 4 RPC C3 sont versionnées).
2. Test négatif : `CREATE FUNCTION public.test_orphan() RETURNS void LANGUAGE sql AS 'SELECT 1';` via apply-sql, re-run, exit 1 avec `test_orphan` dans `MISSING_FROM_MIGRATIONS`. Drop la fonction de test.
3. Documenter dans CLAUDE.md §8 que `db:audit-functions` doit être lancé après chaque migration touchant à une fonction PL/pgSQL.

**Hors scope** : audit des **types** custom, **enums**, **operators**, **aggregates** — même problème conceptuel mais pas de cas réel surfacé. À faire dans un sprint dédié si besoin.

---

### 🟠 Bloc B2 — Trigger function behavior tests (gated)

**Cause root** : `db:check-functions` valide la **présence**, pas le **comportement**. Les 4 fonctions custom orchestrent des effets de bord critiques (auto-create `group_contributions` row, recalcul propor­tion­nel des contributions, cascade DELETE sur `group_contributions`) qu'aucun test n'exerce explicitement. Un `CREATE OR REPLACE FUNCTION ... AS 'BEGIN RETURN NEW; END;'` accidentel passerait inaperçu.

**Fix** : nouveau test gated `lib/__tests__/trigger-behavior.test.ts`, gated par `SUPABASE_TRIGGER_TESTS=1`, pattern dynamic-import + cascade cleanup déjà calé dans [lib/__tests__/api-regressions.test.ts](../lib/__tests__/api-regressions.test.ts) et [lib/finance/__tests__/rpc-concurrency.test.ts](../lib/finance/__tests__/rpc-concurrency.test.ts).

Cas à couvrir (4 minimum, un par fonction custom) :

1. **`trigger_recalculate_contributions` — auto-create on JOIN** : créer un groupe + un profil, set `profile.group_id`, vérifier qu'une ligne `group_contributions` existe pour ce profile_id+group_id avec un `contribution_amount` cohérent.
2. **`trigger_group_budget_change` — recalc on UPDATE** : créer 2 profils dans un groupe, lire les contributions initiales, UPDATE `groups.monthly_budget_estimate`, vérifier que les `contribution_amount` ont été recalculés proportionnellement.
3. **`cleanup_group_contributions` — cascade on DELETE** : créer un groupe avec 2 profils + leurs contributions, DELETE le groupe, vérifier que les `group_contributions` ont été supprimées.
4. **`update_updated_at_column` — touch on UPDATE** : sur 1 des 3 tables (`bank_balances` / `groups` / `profiles`), lire `updated_at` initial, UPDATE n'importe quelle colonne, vérifier que `updated_at` a avancé.

**Critère** :
1. `SUPABASE_TRIGGER_TESTS=1 pnpm test:run` 4/4 verts.
2. Sans la var : skipped (pas d'impact CI standard).
3. Test négatif manuel : `CREATE OR REPLACE FUNCTION public.trigger_recalculate_contributions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;` via apply-sql → suite gated échoue sur le cas 1. Re-applique la migration A2 (la vraie body) → repasse vert.
4. Documenter dans CLAUDE.md §9 (Tests) que `SUPABASE_TRIGGER_TESTS` doit être activé en CI quand on touche une fonction trigger.

**Hors scope** : tests de la chaîne complète métier (ex : recap mensuel modifie le budget → contributions recalculées → notification). Trop lourd pour un test unit gated. Couvert ailleurs (ou à couvrir ailleurs).

---

### 🟡 Bloc B3 — PR-time drift gate (optionnel, low-risk)

**Cause root** : `db-drift-check.yml` tourne lundi 08:00 UTC (Sprint Hardening / H5) + extension A4. Une migration mergée le mardi est invisible 6 jours.

**Fix** : nouveau workflow `.github/workflows/db-drift-pr.yml` qui run sur `pull_request` (paths : `supabase/migrations/**`, `scripts/check-*.mjs`, `scripts/export-schema.mjs`) et exécute les 3 détecteurs. Pas de création d'issue (le PR check failure suffit).

```yaml
on:
  pull_request:
    paths:
      - 'supabase/migrations/**'
      - 'scripts/check-*.mjs'
      - 'scripts/export-schema.mjs'
      - 'scripts/dump-functions.sql'
```

Steps : checkout + pnpm install + `db:check-drift` + `db:check-rpcs` + `db:check-functions`. Pas de `db:audit-functions` (lourd, ad-hoc).

**Critère** : ouvrir une PR test qui drop une fonction du baseline → check rouge sur le PR. Reverter, check vert.

**Risque** : la PR-time check consomme des minutes Actions à chaque push. Mitigation : `paths` filter strict pour ne tirer que sur les modifications DB-relevant.

**Hors scope** : intégration Slack/Discord/email — l'UI GitHub PR suffit.

---

## Ordre d'exécution

1. **B1** d'abord — sans audit générique, B2 et B3 testent un système qu'on sait incomplet. 1 commit, ~80 lignes (script + package.json + CLAUDE.md).
2. **B2** — tests gated. Dépend uniquement de B1 conceptuellement (pour avoir confiance dans la liste). 1 commit (~200 lignes test).
3. **B3** — workflow YAML. 1 commit, optionnel. 30 lignes.

## Critères globaux

- `pnpm typecheck && pnpm lint:check && pnpm test:run` clean
- `pnpm db:check-drift` exit 0
- `pnpm db:check-rpcs` exit 0
- `pnpm db:check-functions` exit 0
- `pnpm db:audit-functions` exit 0 (nouveau)
- `SUPABASE_TRIGGER_TESTS=1 pnpm test:run` 4/4 verts (nouveau)
- 2-3 commits sur `cleanup`

## Risques

1. **B1 — false positives sur les fonctions Supabase-managed**. Le filtre `prokind = 'f'` capture aussi `auth.email()`, `pgcrypto.gen_random_uuid()`, etc. Mitigation : restreindre à `n.nspname = 'public'` + maintenir une liste d'exclusions explicite (`update_updated_at_column` canonique, les 4 RPC C3, les 4 fonctions A2). Toute autre fonction `public.*` doit ou bien être versionnée, ou bien être ajoutée à la liste d'exclusion **avec justification dans le commit message**.
2. **B2 — pollution de la prod par les tests**. Pattern cleanup cascade obligatoire dans `afterAll` (`group_contributions` → `profiles` → `groups` → `auth.admin.deleteUser`). Sans ça, prod accumule des comptes test orphelins (déjà documenté dans CLAUDE.md §9).
3. **B2 — race conditions** entre les triggers et les `expect()`. Les triggers fire `AFTER` mais le client peut lire avant la fin du commit. Wrapper chaque assertion dans une transaction pg ou attendre explicitement le commit retour Supabase.
4. **B3 — secret SUPABASE_ACCESS_TOKEN exposé en PR-time**. Le secret est déjà dans `secrets.SUPABASE_ACCESS_TOKEN` (Sprint Hardening / H5). Vérifier que le check ne fork pas (sinon les PRs externes ont accès au secret) — restreindre `pull_request` à `pull_request_target` + filtre auteur si jamais le repo passe en open-source.

## Hors-scope

- I4 god file refactor — chantier dédié.
- I5 process-step1 extraction — chantier dédié.
- console.log cleanup (1331 occurrences) — chantier dédié.
- Zod rollout — chantier dédié.
- Sprint 1 (Prettier/Husky/CI/ESLint Next 16) — sprint dédié.
- Lint cleanup global (~125 errors) — progressif, hors-sprint (déjà §11).
- Modifications RPC C3 — corrections via nouvelles migrations seulement.
- Audit des **types/enums/operators** custom — pas de cas réel surfacé, à faire si besoin.

---

## Push gate (rappel)

Aucune migration de ce sprint n'écrit du SQL en prod via `supabase db push` ni via `apply-sql.mjs`.
- B1 : nouveau script Node uniquement (lecture `pg_proc`).
- B2 : tests qui créent/cleanup des données mais aucune migration.
- B3 : YAML workflow uniquement.

Si tu introduis une nouvelle fonction `public.*` pendant le sprint (peu probable), suivre le pattern v6 / A2 :
1. Migration `<TS>_<verb>.sql` avec `CREATE OR REPLACE FUNCTION ... SECURITY DEFINER SET search_path = public`.
2. `node scripts/apply-sql.mjs <migration.sql>` (idempotent) ou `pnpm supabase db push --dry-run` → STOP confirmation → `db push`.
3. `pnpm supabase migration repair --status applied <TS>` si apply-sql utilisé.
4. Re-export baseline + update `EXPECTED_FUNCTIONS` dans `check-trigger-functions.mjs`.
5. Re-run `db:audit-functions` pour valider.
