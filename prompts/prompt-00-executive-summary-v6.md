# Sprint Audit-Triggers — close the trigger versioning gap

## Contexte

Le **Sprint Polish** ([prompt-00-executive-summary-v5.md](prompt-00-executive-summary-v5.md), livré 2026-05-07) a refermé T1–T5 en 6 commits sur `cleanup` (`be6af8e → c54fb7f`). T5 (trigger inventory) a surfacé deux trouvailles majeures qui ne tenaient pas dans le scope doc-only :

1. **Bug d'export filter dans le baseline.** Le baseline `20260101000000_remote_schema.sql` dit `-- (no user triggers)` alors que **6 triggers existent en prod sur `public.*`**. Le filtre `tgrelid::regclass::text LIKE 'public.%'` à [scripts/export-schema.mjs:320](../scripts/export-schema.mjs) ne matche jamais : `regclass::text` rend un nom non-qualifié quand `public` est dans le `search_path` de la connexion (ce qui est le cas par défaut). Conséquence : `pnpm db:check-drift` est aveugle aux triggers depuis le début. Si quelqu'un drop un trigger en prod, le détecteur reste vert.

2. **3 fonctions trigger non-versionnées.** Les fonctions `trigger_group_budget_change`, `cleanup_group_contributions`, `trigger_recalculate_contributions` (toutes dans `public`) existent en prod mais **aucune trace** dans `supabase/migrations/`. Même classe de risque que le drift C3 (RPC commitée sans body) — elles peuvent disparaître silencieusement et casser des comportements implicites (ex : `trigger_recalculate_contributions` est ce qui auto-crée une ligne `group_contributions` quand un profil rejoint un groupe, comportement sur lequel s'appuie le test RLS R6).

Le `update_updated_at_column` standard est aussi non-versionné mais c'est du boilerplate Supabase canonique — moins urgent.

L'inventaire complet est dans [docs/db/SCHEMA.md](../docs/db/SCHEMA.md) section "Inventory".

---

### 🔴 Bloc A1 — Fix export filter (CORRECTNESS, drift-detection blind spot)

**Fichier** : [scripts/export-schema.mjs:312-326](../scripts/export-schema.mjs)

**Cause** : `regclass::text` rend `bank_balances` (sans préfixe) quand `public` est dans `search_path`, donc `LIKE 'public.%'` ne matche jamais. Pareil pour `LIKE 'private.%'` etc. — la quasi-totalité des projets Supabase ont `public` en search_path par défaut.

**Fix** :
```sql
SELECT t.tgname,
       (n.nspname || '.' || c.relname) AS table_name,
       pg_get_triggerdef(t.oid) AS def
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE NOT t.tgisinternal
   AND n.nspname = 'public'
 ORDER BY n.nspname, c.relname, t.tgname;
```
(Joint explicitement `pg_namespace` au lieu de comparer la sortie textuelle de `regclass`.)

**Critère** :
1. Re-run `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql`.
2. Le baseline doit maintenant contenir `CREATE TRIGGER ...` pour les 6 triggers `public.*` listés dans [docs/db/SCHEMA.md](../docs/db/SCHEMA.md) (5 distincts une fois dédup `update_*_updated_at`).
3. `pnpm db:check-drift` doit être exit 0 (pas de drift introduit).
4. Test négatif manuel : drop un trigger en local/staging, re-run check-drift, doit exit 1.

---

### 🟠 Bloc A2 — Capture des 3 fonctions trigger non-versionnées

**Action** : nouvelle migration `supabase/migrations/<TS>_capture_trigger_functions.sql` qui contient les 3 (ou 4 avec `update_updated_at_column`) `CREATE OR REPLACE FUNCTION` extraits de prod.

**Comment extraire le SQL** : créer un nouveau script `scripts/dump-functions.sql` similaire à `list-triggers.sql` :

```sql
SELECT n.nspname AS schema, p.proname AS name,
       pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN (
     'trigger_group_budget_change',
     'cleanup_group_contributions',
     'trigger_recalculate_contributions',
     'update_updated_at_column'
   )
 ORDER BY p.proname;
```

Run via `node scripts/apply-sql.mjs scripts/dump-functions.sql`, parser le résultat (voir le pattern UTF-16 LE de PowerShell `>` redirect — utiliser `Out-File -Encoding utf8` ou lire via Read tool), copier les `def` dans la migration en remplaçant `CREATE FUNCTION` par `CREATE OR REPLACE FUNCTION`.

**Garde-fou conventionnel** (rappel CLAUDE.md §8) : chaque fonction doit avoir `SECURITY DEFINER` si elle accède à des tables RLS-protégées (vérifier au cas par cas), `SET search_path = public` pour éviter le SQL injection via search_path. Probablement pas applicable à toutes (les triggers sont déjà `INVOKER` par défaut), mais à valider.

**Critère** :
1. Migration committée + appliquée via `node scripts/apply-sql.mjs <migration.sql>` (pas `supabase db push` — ces fonctions existent déjà, le push échouerait).
2. `supabase migration repair --status applied <TS>` pour aligner `schema_migrations`.
3. Re-export du baseline (avec le filtre fixé d'A1) doit faire apparaître les `CREATE FUNCTION` dans le baseline (ou décider qu'on les exclut intentionnellement comme les RPC C3 — choix à documenter dans CLAUDE.md §8).
4. Test : drop l'une des fonctions en staging, re-run l'app — comportement implicite cassé attendu (ex : auto-create `group_contributions` ne fire plus). Re-applique la migration, comportement revient.

---

### 🟡 Bloc A3 — `pnpm db:check-functions` (parallèle à check-rpcs)

[scripts/check-rpcs.mjs](../scripts/check-rpcs.mjs) vérifie via `pg_proc` que les 4 RPC C3 existent. Pareil pour les 3 fonctions trigger : un script `scripts/check-trigger-functions.mjs` qui exit 1 si l'une des 4 fonctions (`trigger_group_budget_change`, `cleanup_group_contributions`, `trigger_recalculate_contributions`, `update_updated_at_column`) n'est pas dans `pg_proc`.

Ajouter à `package.json` : `"db:check-functions": "node scripts/check-trigger-functions.mjs"`.

**Critère** : `pnpm db:check-functions` exit 0. Drop temporairement une fonction, exit 1.

---

### 🟢 Bloc A4 — CI extension (optionnel, low-risk)

[.github/workflows/](../.github/workflows/) a déjà un cron de `pnpm db:check-drift` weekly (Sprint Hardening / H5). Ajouter `pnpm db:check-rpcs` et `pnpm db:check-functions` au même job. Coût : ~30s ajoutées au cron weekly.

**Critère** : workflow vert, alerte sur Slack/email si une des deux exit 1.

---

## Ordre d'exécution

1. **A1** d'abord — sans le fix du filtre, A2/A3 sont aveugles. 1 commit, 5 lignes diff.
2. **A2** — 1 nouvelle migration + (potentiellement) 1 nouveau script `dump-functions.sql`. 2 commits.
3. **A3** — 1 commit (script + ajout package.json).
4. **A4** — 1 commit, optionnel.

## Critères globaux

- `pnpm typecheck && pnpm lint:check && pnpm test:run` clean
- `pnpm db:check-drift` exit 0
- `pnpm db:check-rpcs` exit 0
- `pnpm db:check-functions` exit 0 (nouveau)
- Baseline re-exporté contient les 6 triggers `public.*`
- 3+ migrations committées (le filtre + au moins 1 capture function migration)
- [docs/db/SCHEMA.md](../docs/db/SCHEMA.md) section "Inventory" mise à jour : retirer les ⚠️ sur les triggers `public.*` (deviennent ✅ une fois trackés).

## Risques

1. **A2 — drift `schema_migrations` ↔ `pg_proc` (le drift C3 redux)**. La migration ne doit PAS être appliquée via `supabase db push` (les fonctions existent déjà, le `CREATE FUNCTION` sans `OR REPLACE` planterait). Strict : `apply-sql.mjs` direct, puis `migration repair --status applied`. Documenter dans le commit message pour ne pas refaire l'erreur du Sprint DB.
2. **A2 — search_path fixé incorrectement**. Les fonctions actuelles peuvent dépendre du search_path utilisateur. Forcer `SET search_path = public` peut changer le comportement si elles attendaient `auth` ou `storage` dans le path. Vérifier `pg_get_functiondef` original pour voir si `SET search_path` est déjà présent — si oui, garder identique.
3. **A3 — false positives**. Si Supabase renomme une fonction system (peu probable), le check exit 1 à tort. Mitigation : pin uniquement nos 3 fonctions custom, pas `update_updated_at_column` (qui est canonique mais pourrait évoluer).

## Hors-scope

- I4 god file refactor — chantier dédié.
- I5 process-step1 extraction — chantier dédié.
- console.log cleanup (1331 occurrences) — chantier dédié.
- Zod rollout — chantier dédié.
- Sprint 1 (Prettier/Husky/CI/ESLint Next 16) — sprint dédié.
- Modifications RPC C3 — corrections via nouvelles migrations seulement.
- Lint cleanup global (~144 errors) — progressif, hors-sprint.
- Capture des fonctions Supabase-managed (`storage.*`, `realtime.*`) — explicit out of scope per H6 decision.

---

## Push gate (rappel)

Aucune migration de ce sprint n'écrit sur la prod via `supabase db push` direct.
Pattern :
1. Écrire la migration en local.
2. `node scripts/apply-sql.mjs <migration.sql>` — l'utilisateur fournit le `SUPABASE_ACCESS_TOKEN` à la commande.
3. `supabase migration repair --status applied <TS>` pour aligner `schema_migrations` (le `apply-sql.mjs` n'écrit pas dans `schema_migrations` automatiquement).
4. Re-export baseline.
5. `pnpm db:check-drift` doit redire clean.
6. Commit.
