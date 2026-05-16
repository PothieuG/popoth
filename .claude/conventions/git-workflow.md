# Git workflow — Husky, Conventional Commits, capture-then-drop, push gate

> Extraction détaillée de CLAUDE.md §3 Husky + §6 Git + workflows §8 capture-then-drop / DROP / Dependabot.

## 1. Branches

- **Default branch GitHub : `cleanup`** depuis Sprint Hygiene-CI / E3 (`main` n'avait jamais reçu les workflows YAML, donc le cron weekly ne fired pas en mode `schedule` ni `workflow_dispatch`). `main` reste figé à 3 commits derrière les sprints livrés.
- Branches feature depuis `cleanup` (la default actuelle).

## 2. Conventional Commits

Types allowlist (enforced commitlint depuis Sprint Commitlint 2026-05-15) :
`feat:`, `fix:`, `chore:`, `docs:`, `perf:`, `test:`, `refactor:`, `style:`, `revert:`, `build:`, `ci:`.

Préfixer le scope quand pertinent : `fix(api/debug)`, `chore(supabase)`. **Enforcement automatique** via hook `.husky/commit-msg` qui invoque `pnpm exec commitlint --edit "$1"`.

Config dans [commitlint.config.js](../../commitlint.config.js) (`@commitlint/config-conventional` + 11 types allow-listed + `header-max-length 100` + `subject-case` OFF + `body-max-line-length` OFF — relax post-audit historique 50 commits).

## 3. Husky hooks

3 hooks installés (Sprint Lint-Followups / Sprint 1 / Sprint Commitlint) :

- **pre-commit** ([.husky/pre-commit](../../.husky/pre-commit)) — `pnpm lint-staged` (prettier `--write` + eslint `--fix` sur fichiers staged). Première ligne de défense locale.
- **pre-push** ([.husky/pre-push](../../.husky/pre-push)) — `pnpm lint:check && pnpm typecheck` fail-fast. Filet final full-tree avant le PR gate `code-checks.yml`.
- **commit-msg** ([.husky/commit-msg](../../.husky/commit-msg)) — `pnpm exec commitlint --edit "$1"`. Tout commit hors convention sort exit 1.

Le `prepare` script dans [package.json](../../package.json) ré-arme automatiquement `.husky/_/` à chaque `pnpm install` — note : si le hook ne fire pas après un fresh clone, lancer `pnpm exec husky` manuellement.

Bypass d'urgence via `git commit --no-verify` / `git push --no-verify` toujours possible **mais à éviter** (cf. règle `JAMAIS --no-verify` §7).

## 4. Convention commits

- **Un commit par item** dans les sprints multi-items (cf. Sprint 0 : 5 commits + 1 follow-up).
- **Toujours créer un nouveau commit**, jamais `--amend` un commit publié.

## 5. Workflow capture-then-drop (objets DB)

Pour capturer rétroactivement une fonction PL/pgSQL qui existe déjà en prod (cas Sprint Audit-Triggers / A2) : workflow strict, **NE PAS** faire `supabase db push` (collision sur la fonction existante).

```bash
# 1. Dump le body via [scripts/dump-functions.sql](../../scripts/dump-functions.sql) (étendre la liste si besoin)
node scripts/apply-sql.mjs scripts/dump-functions.sql > tmp/functions.json

# 2. Coller le `def` (déjà sous forme `CREATE OR REPLACE FUNCTION` en PG 14+, vérifier)
#    dans une migration `<TS>_capture_*.sql`.
#    Préserver verbatim (LANGUAGE, SECURITY, SET search_path) — ne PAS ajouter REVOKE/GRANT boilerplate.

# 3. Appliquer (idempotent grâce à CREATE OR REPLACE)
node scripts/apply-sql.mjs supabase/migrations/<TS>_capture_*.sql

# 4. Marquer applied (sinon prochain db push retentera = drift C3 redux)
pnpm supabase migration repair --status applied <TS>

# 5. Re-export baseline + check drift
node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
pnpm db:check-drift  # exit 0
```

## 6. Workflow DROP (objet DB confirmé dead code)

Pour DROP une fonction (ou tout objet DB) déjà capturée et confirmée dead code (cas Sprint Cleanup-Legacy / C1).

**Pré-requis** : la migration de capture existe déjà, vérifier 0 callsite app (Grep), 0 référence GitHub Actions, 0 cron Supabase / webhook / Edge Function.

```bash
# 1. Migration `<TS>_drop_*.sql` avec DROP RESTRICT (ne PAS utiliser CASCADE — Postgres refuse explicitement si dépendance cachée)
#    Inclure `NOTIFY pgrst, 'reload schema';` à la fin.

# 2. Appliquer (HTTP 201 + [] = OK ; tout autre code = dépendance détectée, investigate)
node scripts/apply-sql.mjs supabase/migrations/<TS>_drop_*.sql

# 3. Marquer applied
pnpm supabase migration repair --status applied <TS>

# 4. Re-export baseline + check drift
node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
pnpm db:check-drift  # exit 0

# 5. Régénérer types
pnpm db:types
pnpm typecheck  # exit 0

# Recovery path : re-apply de la migration de capture (CREATE OR REPLACE idempotent)
```

## 7. Push gate prod

```
pnpm supabase db push --dry-run → STOP confirmation utilisateur → db push → re-audit Management API → commit
```

## 8. Régénération types après changement de schéma

```bash
pnpm db:types  # sans redirection — le script s'écrit lui-même dans lib/database.types.ts depuis Sprint Polish-CI / D1
pnpm db:check-types-fresh  # exit 0 = synchro, 1 = il faut re-pnpm db:types + commit
```

Le PR-time gate exécute aussi `db:check-types-fresh` sur tout PR touchant `lib/database.types.ts` ou `supabase/migrations/**`.

## 9. Workflow Dependabot post-merge

Quand une PR Dependabot est mergée (workflow appris au follow-up Sprint DX-Verify, 2026-05-07 ; filet CI fermé Sprint Stabilize-Deps / S2) :

1. `git pull origin cleanup` puis `pnpm install` pour aligner les modules locaux sur le nouveau lockfile.
2. **`pnpm verify`** (Sprint DX-Verify / G1) — exit 0 attendu. Depuis Sprint Stabilize-Deps / S2, [.github/workflows/code-checks.yml](../../.github/workflows/code-checks.yml) re-tourne aussi sur `push: branches: [cleanup]`.
3. **Démarrer `pnpm dev`** et hit `curl http://localhost:3000/` au moins une fois — le typecheck + tests ne couvrent pas les régressions runtime/compile-CSS qui ne se voient qu'au premier render.
4. **Si une PR Dependabot a cassé quelque chose** : préférer le **fix-forward** (`pnpm update <pkg>@<version>` + commit `revert: re-pin <pkg> to <version>`) plutôt que `git revert -m 1 <merge>`. Les merges Dependabot enchaînés touchent presque toujours le même lockfile → conflits sur `git revert -m 1` quasi-garantis. Pattern appliqué pour react (7989ed2) et supabase (3e37015) au follow-up DX-Verify.
5. **Au moindre doute sur un major bump qui re-cassera au prochain scan** : ajouter un `ignore` dans [.github/dependabot.yml](../../.github/dependabot.yml) :
   - `update-types: ["version-update:semver-major"]` pour bloquer tous les majors d'un package (cas tailwindcss).
   - `versions: [">=X.Y.Z"]` pour bloquer une plage précise après laquelle un breaking change a été introduit (cas supabase-js >=2.105).
   - `versions: [">=N.0.0"]` pour pinner sur un major existant (cas eslint-config-next ≥16).
6. **⚠️ Interaction `ignore` ↔ Dependabot security updates** : par défaut, **les `versions: [...]` rules bloquent AUSSI les security PRs**, pas seulement les version updates. En revanche, **les `update-types: ["version-update:*"]` rules ne bloquent que les version updates**, donc les security PRs passent toujours. Si un CVE critique tombe sur supabase-js 2.105+ ou eslint-config-next 16+, retirer temporairement le `ignore` rule pour laisser le security PR être créée, puis re-mettre.

## 10. Règles d'or

- **JAMAIS** `--no-verify`, `--no-gpg-sign`, ou `git push --force` sans demande explicite.
- **Ne pas commiter** de secret. `supabase/.gitignore` exclut `.temp/` et `.env.local`. `.claude/settings.local.json` est désormais gitignored.
- **Ne pas écrire** la phrase littérale `eslint-disable-next-line` dans un commentaire de documentation qui n'est PAS un disable directive — ESLint la parse comme une tentative de disable d'une rule nommée "directive." Reformuler en "lint suppression comment" ou "directive eslint-disable".
- **Ne pas ajouter** un trigger ou un handler-side cleanup pour cascader la nullification d'une FK avant d'avoir vérifié si la FK a déjà `ON DELETE SET NULL` / `ON DELETE CASCADE`. Cas vu Sprint 2-followup-v3 / Item 1 : un trigger `BEFORE DELETE` deployé pour null `profiles.group_id` était redondant avec `profiles_group_id_fkey ON DELETE SET NULL`.

## 11. RPC conventions

Pour toute nouvelle RPC :

- `SECURITY DEFINER`
- `REVOKE ALL FROM PUBLIC`
- `GRANT EXECUTE TO service_role`
- `SET search_path = public`
- `NOTIFY pgrst, 'reload schema';` à la fin (sinon `.rpc()` lève "Could not find the function in the schema cache" — leçon Sprint DB).

Pour toute nouvelle fonction trigger ou modification d'une existante : versionner dans une migration dédiée (pattern : [supabase/migrations/20260512000000_capture_trigger_functions.sql](../../supabase/migrations/20260512000000_capture_trigger_functions.sql), `CREATE OR REPLACE FUNCTION`). Le baseline n'inclut PAS les bodies de fonction — c'est volontaire (pattern C3) et `pnpm db:check-functions` tient le filet.

**Après toute migration touchant une fonction PL/pgSQL** : lancer `pnpm db:audit-functions` (Sprint Audit-Functions-v2 / B1).
**Après toute migration ajoutant un `CREATE TYPE` / `CREATE DOMAIN` / `CREATE OPERATOR`** : lancer `pnpm db:audit-objects` (Sprint Cleanup-Legacy / C2).
**Après chaque migration non-triviale** : lancer `pnpm db:check-drift`. Si exit 1, re-exporter le baseline via `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql` et committer (sinon le détecteur reste rouge et on retombe dans la trap C3).
