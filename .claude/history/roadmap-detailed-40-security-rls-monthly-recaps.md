# Roadmap détaillée — Part 40 : Security-RLS-Monthly-Recaps (2026-06-03)

> Sprint sécurité déclenché par un rapport du linter Supabase (`rls_disabled_in_public`, niveau ERROR, facing EXTERNAL) reçu par mail. 1 finding → fix + cause racine + filet anti-récidive. Pattern miroir du Sprint DB / D1 (RLS `piggy_bank`).

## Le finding

```
rls_disabled_in_public | ERROR | EXTERNAL | Table public.monthly_recaps is public, but RLS has not been enabled.
```

`monthly_recaps` était la **seule** table du schéma `public` sans Row Level Security activée (vérifié via `pg_class.relrowsecurity` sur les ~30 tables prod). Or les rôles `anon` et `authenticated` détiennent les grants DML complets (`SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE`) sur la table. Conséquence concrète : **n'importe qui détenant l'anon key publique** (embarquée dans le bundle navigateur comme `NEXT_PUBLIC_SUPABASE_ANON_KEY`) **pouvait lire ET modifier les récaps mensuels de tous les utilisateurs** directement via l'API REST PostgREST (`/rest/v1/monthly_recaps`), en contournant entièrement l'app. Expo réelle, externe, exploitable.

## Pourquoi l'app n'était pas impactée par le fix

Vérifié avant de toucher quoi que ce soit : tout l'accès applicatif à `monthly_recaps` passe par `lib/recap/*` via `supabaseServer` (service_role, attribut `bypassrls`), y compris le gating `proxy.ts` (`checkRecapStatus` → `supabaseServer`). Le client browser anon (`lib/supabase-client.ts`) n'est importé que par les flows d'auth (`inscription`, `reset/forgot-password`, `auth/confirm`, `auth/session`, `lib/auth.ts`) — **jamais** sur `monthly_recaps`. Donc activer la RLS (deny-all anon par défaut) ne casse rien : service_role bypasse la RLS.

## Le fix — RLS sans policy (migration `20260609000000_enable_rls_monthly_recaps.sql`)

```sql
ALTER TABLE "monthly_recaps" ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
```

**Sans policy, volontairement.** `monthly_recaps` est une table 100 % server-side. RLS activée + 0 policy = deny-all pour `anon`/`authenticated` (default-deny PostgreSQL), accès complet conservé pour `service_role`. C'est exactement ce que le trigger `rls_auto_enable` du repo aurait fait à la création. Contraste avec D1 (`piggy_bank`) qui, lui, était lu par le client browser et nécessitait donc des policies owner-scoped (`profile_id = auth.uid() OR group_id IN (...)`). Ici, ajouter des policies permissives **affaiblirait** la posture (ouvrir une porte correctement fermée) et serait inopérant de toute façon — l'auth est un JWT custom `jose`, pas Supabase Auth, donc `auth.uid()` est NULL pour toute requête applicative.

## Cause racine + (a) restauration de l'event trigger (`20260609000001_create_ensure_rls_event_trigger.sql`)

La fonction event-trigger `rls_auto_enable()` (capturée Sprint 02 MRv3, migration `20260524000002`) auto-active la RLS sur toute nouvelle table `public` au `CREATE TABLE`. En comparant `pg_event_trigger` entre dev et prod :

- **dev** (`ddehmjucyfgyppfkbddr`) : event trigger `ensure_rls` bien bindé (`ddl_command_end`, tags `CREATE TABLE / CREATE TABLE AS / SELECT INTO`, fn `rls_auto_enable`).
- **prod** (`jzmppreybwabaeycvasz`) : event trigger **absent** (seuls les triggers Supabase natifs — pgrst, graphql, pg_cron, pg_net — étaient là). La fonction existait (1), le binding non (0).

→ C'est pourquoi `monthly_recaps`, créée sur prod le 2026-05-24, est passée à travers, et surtout **toute future table prod** n'aurait pas auto-activé sa RLS. Fix :

```sql
DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION rls_auto_enable();
```

Répliqué à l'identique de la dev. Idempotent via `DROP IF EXISTS`. Les event triggers vivent dans `pg_event_trigger`, **pas** `pg_trigger` → ils ne sont **pas** capturés par `scripts/export-schema.mjs` (qui ne lit que `pg_trigger`), donc cette migration **n'affecte pas la baseline** (pas de drift). C'est précisément cet angle mort qui a laissé passer le bug.

## (b) Guard `db:check-rls` ([scripts/check-rls.mjs](../../scripts/check-rls.mjs))

Filet anti-récidive câblé dans `pnpm verify` (après `db:check-drift`). Interroge `pg_class` pour toute table `public` (`relkind IN ('r','p')`) avec `relrowsecurity = false`. Exit 0 si aucune, exit 1 + listing sinon, exit 2 fatal. Mirroir de `check-rpcs.mjs` (token via `SUPABASE_ACCESS_TOKEN`, override `SUPABASE_PROJECT_REF`, `process.exitCode` pour drain undici propre).

**Pourquoi en plus de `db:check-drift`** : la baseline capture l'état RLS-enable, mais un drift vert ne signifie que « prod == baseline committée ». Si une table manque de RLS dans prod ET la baseline, le drift reste vert. `db:check-rls` assert l'invariant absolu directement, indépendamment de la baseline.

Ajouté à `package.json` : script `db:check-rls` + inséré dans la chaîne `verify` (6 → 7 db checks).

## Validation end-to-end (probe jetable sur dev)

Pour prouver que (a) et (b) fonctionnent réellement (pas juste « la ligne existe »), test sur dev avec une table jetable `_rls_probe` :

1. `CREATE TABLE public._rls_probe (id int)` → `relrowsecurity = true` immédiatement ⇒ **l'event trigger `ensure_rls` a auto-activé la RLS** (a prouvé fonctionnellement).
2. `ALTER TABLE _rls_probe DISABLE ROW LEVEL SECURITY` puis `pnpm db:check-rls` → **exit 1**, liste `_rls_probe` (b chemin rouge prouvé, propagé par pnpm).
3. `DROP TABLE _rls_probe` + re-check → exit 0, dev clean.

## Application + vérification

- **Prod** : 2 migrations appliquées via `apply-sql.mjs` (Management API), enregistrées dans `supabase_migrations.schema_migrations` (`20260609000000`, `20260609000001`). Post-état : `monthly_recaps.rls_enabled = true`, `public_tables_without_rls = []`, `ensure_rls` bindé.
- **Dev** : RLS activée sur `monthly_recaps` (dev avait le même trou) ; event trigger déjà présent.
- **Baseline** re-exportée (`export-schema.mjs`) : +1 ligne `ALTER TABLE "monthly_recaps" ENABLE ROW LEVEL SECURITY;` (placée alphabétiquement), aucun autre drift. `pnpm db:check-drift` exit 0.
- `pnpm db:check-rls` exit 0 sur prod ET dev.

## Fichiers livrés

- `supabase/migrations/20260609000000_enable_rls_monthly_recaps.sql` (fix RLS)
- `supabase/migrations/20260609000001_create_ensure_rls_event_trigger.sql` (a — cause racine)
- `scripts/check-rls.mjs` (b — guard)
- `package.json` (script `db:check-rls` + chaîne `verify`)
- `supabase/migrations/20260101000000_remote_schema.sql` (baseline +1 ligne)

## ❌ À ne pas réintroduire

- ❌ **NE PAS** créer une table `public` sans RLS. L'event trigger `ensure_rls` (prod + dev) l'active automatiquement à la création ; `pnpm db:check-rls` (dans `verify`) échoue sinon. Ne pas DROP l'event trigger.
- ❌ **NE PAS** ajouter de policies permissives sur `monthly_recaps` (ou toute table server-only accédée uniquement en service_role) « pour faire propre ». RLS sans policy = deny-all correct ; une policy owner-scoped n'est requise **que** si le client browser/anon lit la table (cas `piggy_bank` D1).
- ❌ **NE PAS** attendre de `db:check-drift` qu'il détecte une table sans RLS : si elle manque de RLS dans prod ET la baseline, le drift reste vert. C'est `db:check-rls` qui tient cet invariant.
- ❌ **NE PAS** compter sur `export-schema.mjs` pour capturer les event triggers (`pg_event_trigger`) — il ne lit que `pg_trigger`. Un binding event-trigger manquant est invisible au drift.
