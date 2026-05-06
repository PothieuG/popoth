# Sprint DB — Stabilisation, sécurisation et optimisation Supabase

## Contexte

Le **Sprint 0** ([prompts/prompt-00-executive-summary.md](prompts/prompt-00-executive-summary.md), exécuté le 2026-05-06) a stabilisé l'application côté code (TS strict, debug routes bloquées en prod, race conditions piggy_bank fixées via 4 RPC atomiques). Le score audit est passé de **47 → ~51/100**.

L'audit RLS Supabase ([docs/audit/RLS-FINDINGS.md](docs/audit/RLS-FINDINGS.md)) — exécuté via l'API Management Supabase (Docker non installé) — a révélé **3 failles critiques RLS encore actives en production** :

1. 🔴 **`piggy_bank` n'a PAS RLS activé** et aucune policy. La REST API publique de Supabase expose lecture/écriture sur la tirelire de **n'importe quel utilisateur**, pour n'importe quel client (anon ou authenticated). Les RPC C3 protègent l'écriture côté serveur, mais le client browser peut bypasser.
2. 🔴 **`group_contributions` policy `ALL` ouverte** : `USING (auth.uid() IS NOT NULL)` — tout user authentifié peut lire/écrire/supprimer toutes les contributions de tous les groupes, indépendamment de son appartenance.
3. 🔴 **`remaining_to_live_snapshots.INSERT WITH CHECK true` avec `roles={public}`** (malgré le nom "Service role can insert") : tout user authentifié peut insérer un snapshot pour n'importe quel `profile_id` ou `group_id`.

À cela s'ajoutent des dettes structurelles non couvertes par le Sprint 0 :

- Schéma DB **non versionné** côté repo (pas de migration `*_remote_schema.sql`). `supabase db pull` requiert Docker (absent sur Windows local) ; un export alternatif est nécessaire.
- Aucun **type TypeScript généré** depuis le schéma Supabase (`pnpm supabase gen types`) — d'où les nombreux `any` Supabase et le triage TS du Sprint 0.
- **Indexes potentiellement manquants** sur les FK et colonnes de filtre fréquent (`profile_id`, `group_id`, `estimated_budget_id`).
- **Contraintes manquantes** : pas de `CHECK (amount >= 0)` sur les soldes monétaires, pas d'`ON DELETE CASCADE` cohérent.
- Les **RPC C3 ne sont jamais testées en concurrence** (vitest installé mais pas de test load).

Ce prompt vise l'exécution **complète du Sprint DB** afin de faire passer le score à environ **58/100** et d'éliminer les 3 failles RLS critiques avant tout autre chantier feature.

## Fichiers à analyser en priorité

- [docs/audit/RLS-FINDINGS.md](docs/audit/RLS-FINDINGS.md) — matrice RLS remplie + 3 findings critiques + SQL de remédiation
- [supabase/migrations/20260506000000_create_finance_rpcs.sql](supabase/migrations/20260506000000_create_finance_rpcs.sql) — 4 RPC atomiques C3 (à NE PAS modifier, à compléter si besoin)
- [supabase/config.toml](supabase/config.toml) — config CLI Supabase (lié à `jzmppreybwabaeycvasz`)
- [lib/supabase-server.ts](lib/supabase-server.ts) — client serveur (service_role, bypass RLS)
- [lib/supabase-client.ts](lib/supabase-client.ts) — client browser (anon key, soumis à RLS) ⚠️ exposé à la faille piggy_bank
- [lib/finance/](lib/finance/) — helpers RPC TS (piggy-bank, bank-balance, budget-savings, context)
- [lib/financial-calculations.ts](lib/financial-calculations.ts) — god file 1075 LOC (queries hot path à profiler)
- [docs/audit/07-deep-dive-rls-supabase.md](docs/audit/07-deep-dive-rls-supabase.md) — playbook RLS complet
- [CLAUDE.md](CLAUDE.md) — conventions projet (lire avant d'écrire toute migration)

## Objectifs précis

### 🔴 Bloc 1 — Failles RLS critiques (commit `fix(rls): close 3 critical RLS gaps`)

1. **D1 — Activer RLS sur `piggy_bank`** (faille publique).
   Migration `supabase/migrations/<timestamp>_secure_piggy_bank.sql` :
   ```sql
   ALTER TABLE piggy_bank ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users can view their own piggy_bank" ON piggy_bank
     FOR SELECT USING (
       profile_id = auth.uid()
       OR (group_id IS NOT NULL AND group_id IN (
         SELECT group_id FROM profiles WHERE id = auth.uid()
       ))
     );
   CREATE POLICY "Users can manage their own piggy_bank" ON piggy_bank
     FOR ALL USING (...même prédicat...);
   ```
   Vérifier que les RPC C3 (`SECURITY DEFINER`) continuent de fonctionner (elles bypassent RLS par design). Tester depuis le client browser que la lecture d'une autre tirelire renvoie `[]`.

2. **D2 — Resserrer `group_contributions`**.
   ```sql
   DROP POLICY "Authenticated users can manage contributions" ON group_contributions;
   CREATE POLICY "Group members can manage their group contributions"
     ON group_contributions FOR ALL
     USING (group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid()));
   ```

3. **D3 — Resserrer `remaining_to_live_snapshots.INSERT`**.
   ```sql
   DROP POLICY "Service role can insert snapshots" ON remaining_to_live_snapshots;
   CREATE POLICY "Users can insert their own snapshots"
     ON remaining_to_live_snapshots FOR INSERT
     WITH CHECK (
       profile_id = auth.uid()
       OR (group_id IS NOT NULL AND group_id IN (
         SELECT group_id FROM profiles WHERE id = auth.uid()
       ))
     );
   ```

4. **D4 — Tests d'intégration RLS**.
   Créer `lib/finance/__tests__/rls.test.ts` (Vitest) qui :
   - Auth en tant que user A, tente lecture de `piggy_bank` de user B → doit retourner `[]` ou erreur 403.
   - Auth en tant que user A non-membre du groupe G, tente lecture `group_contributions` du groupe G → doit retourner `[]`.
   Utiliser `supabaseClient` (anon) avec deux JWT user de test. Si pas de seed disponible, marquer `describe.skip` avec doc d'invocation manuelle.

### 🟡 Bloc 2 — Schéma versionné (commit `chore(db): version remote schema`)

5. **D5 — Pull schéma sans Docker**.
   Trois options par ordre de préférence :
   - **(a)** Si Docker disponible : `pnpm supabase db pull --schema public` (générera `supabase/migrations/<ts>_remote_schema.sql`).
   - **(b)** Sinon, via API Management : exporter `pg_dump`-équivalent en interrogeant `information_schema.columns`, `pg_indexes`, `pg_constraint`, `pg_policies`. Composer manuellement un fichier `supabase/migrations/<ts>_remote_schema.sql`.
   - **(c)** Via Supabase Studio : Database > Schema visualizer > Export SQL → coller dans `supabase/migrations/<ts>_remote_schema.sql`.
   Vérifier que les migrations C3 + D1-D3 sont **après** ce dump (timestamps croissants).

6. **D6 — Générer types TS depuis le schéma**.
   ```bash
   pnpm supabase gen types typescript --linked --schema public > lib/database.types.ts
   ```
   Importer `Database` dans `lib/supabase-server.ts` et `lib/supabase-client.ts` :
   ```ts
   import type { Database } from '@/lib/database.types'
   export const supabaseServer = createClient<Database>(...)
   ```
   Ajouter script `pnpm db:types` dans `package.json` pour régénérer.
   Refactorer **au moins 3 sites** d'`any` Supabase pour utiliser les nouveaux types (priorité : [app/api/finances/dashboard/route.ts](app/api/finances/dashboard/route.ts), [lib/expense-allocation.ts](lib/expense-allocation.ts), [lib/financial-calculations.ts](lib/financial-calculations.ts)).

### 🟡 Bloc 3 — Performance & intégrité (commit `perf(db): add indexes and constraints`)

7. **D7 — Audit indexes**.
   Via API Management ou Studio, lister :
   ```sql
   SELECT schemaname, tablename, indexname, indexdef
   FROM pg_indexes WHERE schemaname='public' ORDER BY tablename;
   ```
   Pour chaque FK des tables `real_expenses.estimated_budget_id`, `real_expenses.profile_id`, `real_expenses.group_id`, `real_income_entries.estimated_income_id`, `budget_transfers.from_budget_id` / `to_budget_id`, `monthly_recaps.profile_id` / `group_id`, etc., vérifier qu'un index existe. Si non, créer migration `supabase/migrations/<ts>_add_fk_indexes.sql`.
   Profiler les requêtes hot path via `EXPLAIN (ANALYZE, BUFFERS)` :
   - `lib/financial-calculations.ts:getProfileFinancialData` (ligne ~50-200)
   - `app/api/finances/dashboard/route.ts:GET` (full dashboard fetch)
   - `app/api/monthly-recap/process-step1/route.ts` (boucles sur budgets/expenses)

8. **D8 — Audit contraintes**.
   ```sql
   SELECT conrelid::regclass AS table, conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conrelid::regclass;
   ```
   Vérifier/ajouter migration `supabase/migrations/<ts>_add_constraints.sql` :
   - `bank_balances.balance` : pas de contrainte (peut être négatif intentionnellement, OK)
   - `piggy_bank.amount` : `CHECK (amount >= 0)` (la RPC le vérifie déjà mais ceinture+bretelles)
   - `estimated_budgets.cumulated_savings` : `CHECK (cumulated_savings >= 0)` idem
   - `estimated_budgets.estimated_amount` : `CHECK (estimated_amount >= 0)`
   - `real_expenses.amount` : `CHECK (amount > 0)` (interdire 0 et négatif)
   - FK `ON DELETE` : confirmer que la suppression d'un `estimated_budget` cascade ou bloque les `real_expenses` (cohérence métier).
   - `UNIQUE (profile_id) WHERE group_id IS NULL` et `UNIQUE (group_id) WHERE profile_id IS NULL` sur `piggy_bank` et `bank_balances` (1 ligne par contexte).

### 🟢 Bloc 4 — Tests RPC concurrence (commit `test(finance): cover RPC under concurrency`)

9. **D9 — Test charge des 4 RPC**.
   Créer `lib/finance/__tests__/rpc-concurrency.test.ts` :
   ```ts
   it('100 concurrent updatePiggyBank(+1) converge to start+100', async () => {
     await testSupabase.from('piggy_bank').upsert({ profile_id: TEST_USER, group_id: null, amount: 1000 })
     await Promise.all(Array.from({length:100}, () => updatePiggyBank({profile_id:TEST_USER}, 1)))
     const { data } = await testSupabase.from('piggy_bank').select('amount').eq('profile_id',TEST_USER).single()
     expect(data?.amount).toBe(1100)
   })
   ```
   Couvrir aussi : delta négatif jusqu'à 0 puis -1 (doit lever), `transferFromPiggyToBudget` atomique (rollback complet si l'une des deux UPDATE échoue), `updateBudgetCumulatedSavings` parallèle.
   Nécessite un user de test seedé. Si Supabase local indisponible (Docker), pointer sur un projet Supabase staging via `.env.test`.

### 🟢 Bloc 5 — Dette mineure (commit `chore(db): cleanup misc gaps`)

10. **D10 — Nettoyage policies redondantes** :
    - `profiles` : drop la policy "Users can view own profile" (public) ou "Users can read own profile" (authenticated) — ce sont des doublons exacts.
    - `profiles` : décider si une policy DELETE est nécessaire (admin only ? auto-suppression compte ?). Documenter dans la migration.
    - `groups` : vérifier que "Users can view all groups" (`USING true`) est intentionnel pour la recherche. Si non, restreindre à `creator_id = auth.uid() OR id IN (SELECT group_id FROM profiles WHERE id = auth.uid())`.

11. **D11 — Documenter le schéma**.
    Créer [docs/db/SCHEMA.md](docs/db/SCHEMA.md) listant les ~13 tables avec : colonnes principales, FK, RLS status, RPC associées (si C3). À générer depuis l'export D5 + matrice D1.

## Contraintes techniques

- **Stack inchangée** : Next.js 16.1.6 (App Router), React 19.1.1, TypeScript 5 strict + `noUncheckedIndexedAccess`, Supabase, pnpm 9.15.5, Vitest 4.1.5.
- **Format réponse API** : conserver `{ data: T } | { error: string }` partout.
- **Naming** : snake_case côté SQL, camelCase côté TS. Migrations préfixées `<YYYYMMDDHHMMSS>_<verb>_<scope>.sql`.
- **Sécurité RPC** existant : `SECURITY DEFINER` + `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role`. Toute nouvelle RPC doit suivre ce pattern.
- **Ne PAS modifier** [supabase/migrations/20260506000000_create_finance_rpcs.sql](supabase/migrations/20260506000000_create_finance_rpcs.sql) (Sprint 0 C3 livré). Si correction nécessaire, faire un `CREATE OR REPLACE` dans une nouvelle migration.
- **Ne PAS toucher** au refactor de [lib/financial-calculations.ts](lib/financial-calculations.ts) (chantier I4 séparé) — uniquement profiler/indexer ses queries.
- **Ne PAS toucher** à l'algo `process-step1` (chantier I5 séparé) — uniquement profiler.
- **Pas de mock DB** : tests d'intégration sur projet Supabase (local via Docker OU staging cloud).
- **Credentials** : SUPABASE_ACCESS_TOKEN + DB password à fournir interactivement, jamais commiter. L'API Management `POST /v1/projects/{ref}/database/query` permet d'exécuter du SQL sans Docker (cf. RLS-FINDINGS.md).

## Critères de validation

- `pnpm typecheck && pnpm lint:check && pnpm build` passent à chaque commit.
- `pnpm test:run lib/debug-guard.test.ts` reste vert (régression Sprint 0).
- `pnpm test:run lib/finance/__tests__/rpc-concurrency.test.ts` vert (D9).
- API Management retourne `rowsecurity=true` pour `piggy_bank` (D1).
- Aucune policy avec `qual='true' OR with_check='true'` côté `pg_policies` (D2, D3, D10).
- `lib/database.types.ts` existe et est importé dans `lib/supabase-server.ts` (D6).
- Toutes les FK des tables `real_expenses`, `real_income_entries`, `budget_transfers`, `monthly_recaps` ont un index (D7).
- `ls supabase/migrations/` contient au moins : `20260506000000_create_finance_rpcs.sql`, `<ts>_remote_schema.sql`, `<ts>_secure_piggy_bank.sql`, `<ts>_add_fk_indexes.sql`, `<ts>_add_constraints.sql`.

## Instructions pour Claude Code

- **Lire avant d'écrire** : RLS-FINDINGS.md, CLAUDE.md, et chaque migration existante avant d'ajouter une nouvelle.
- **Une PR par bloc** (pas par item D). 5 commits Conventional Commits attendus :
  1. `fix(rls): close 3 critical RLS gaps` (D1-D4)
  2. `chore(db): version remote schema` (D5-D6)
  3. `perf(db): add indexes and constraints` (D7-D8)
  4. `test(finance): cover RPC under concurrency` (D9)
  5. `chore(db): cleanup misc gaps` (D10-D11)
- **Vérifier après chaque commit** : `pnpm typecheck && pnpm lint:check && pnpm build && pnpm test:run`.
- **API Management Supabase** : à utiliser pour toute requête `pg_*` ou `information_schema` lorsque Docker indisponible. Pattern :
  ```bash
  curl -s -X POST "https://api.supabase.com/v1/projects/$PROJECT/database/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"query":"<SQL>"}'
  ```
- **Migrations destructives** : sur D1-D3, créer la nouvelle policy AVANT le DROP de l'ancienne pour éviter une fenêtre de RLS-off (Postgres applique le `ALTER TABLE` puis le `CREATE POLICY` dans la même transaction si on les met dans le même fichier — vérifier).
- **Demander confirmation** avant d'exécuter une migration sur le projet distant. Préférer dry-run via Studio en staging.
- **Si Docker installé en cours de route** : basculer sur `pnpm supabase db pull` officiel pour D5 et `pnpm supabase test db` pour D9.
- **Ne pas committer** de secret. Le fichier `supabase/.gitignore` exclut déjà `.temp/` et `.env.local`.
