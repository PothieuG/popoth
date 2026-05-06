# Audit RLS Supabase — État initial

**Date** : 2026-05-06
**Scope** : Sprint 0 / item C4
**Statut** : ⚠️ **Audit incomplet** — `supabase db pull` n'a pas pu être exécuté automatiquement (échec d'authentification SASL sur le pooler). Les requêtes ci-dessous sont à exécuter manuellement par l'utilisateur dans le SQL Editor de Supabase Studio, puis les résultats à reporter dans ce fichier.

## Setup réalisé

- ✅ `pnpm supabase` (v2.98.2) installé en devDependencies.
- ✅ `pnpm supabase init` exécuté → `supabase/config.toml` créé.
- ✅ `pnpm supabase link --project-ref jzmppreybwabaeycvasz` exécuté → projet lié.
- ❌ `pnpm supabase db pull` échoue avec `password authentication failed for user "postgres" (SQLSTATE 28P01)`. Le mot de passe DB doit être réinitialisé via [Project Settings > Database > Reset database password](https://supabase.com/dashboard/project/jzmppreybwabaeycvasz/settings/database) avant de réessayer.

## Procédure manuelle pour compléter l'audit

### 1. Pull du schéma (à faire après reset password)

```bash
SUPABASE_DB_PASSWORD="<nouveau_mot_de_passe>" pnpm supabase db pull --schema public
```

Cela génère `supabase/migrations/<timestamp>_remote_schema.sql`. **Avant de commiter** : vérifier que ce fichier ne contient ni mot de passe, ni `ALTER USER ... PASSWORD`, ni token JWT.

### 2. Vérifications RLS (SQL Editor : https://supabase.com/dashboard/project/jzmppreybwabaeycvasz/sql)

#### 2.1 Statut RLS par table (publique uniquement)

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

**Action** : reporter ci-dessous les tables où `rowsecurity = false`. Toute table sensible (cf. liste 2.4) sans RLS doit être traitée en priorité.

#### 2.2 Recensement complet des policies

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;
```

**Action** : exporter le résultat en JSON/CSV et le coller dans la section "Inventaire des policies" plus bas.

#### 2.3 Détection de policies dangereuses (USING true / WITH CHECK true)

```sql
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true');
```

**Action** : tout résultat ici est un risque critique d'exposition. À noter dans la matrice ci-dessous.

#### 2.4 Couverture par opération (SELECT/INSERT/UPDATE/DELETE)

```sql
SELECT tablename, cmd, COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles', 'groups', 'group_members',
    'estimated_budgets', 'estimated_incomes',
    'real_expenses', 'real_income_entries',
    'bank_balances', 'piggy_bank',
    'monthly_recaps', 'budget_transfers',
    'recap_snapshots', 'group_contributions'
  )
GROUP BY tablename, cmd
ORDER BY tablename, cmd;
```

**Action** : reporter dans la matrice ci-dessous. Une cellule vide = aucune policy pour cette opération sur cette table = accès interdit (si RLS activé) ou accès libre (si RLS désactivé).

## Matrice à remplir

| Table | RLS activé | SELECT | INSERT | UPDATE | DELETE | Policies dangereuses ? |
|---|---|---|---|---|---|---|
| `profiles` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `groups` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `group_members` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `estimated_budgets` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `estimated_incomes` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `real_expenses` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `real_income_entries` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `bank_balances` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `piggy_bank` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `monthly_recaps` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `budget_transfers` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `recap_snapshots` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| `group_contributions` | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |

## Inventaire des policies

_(coller ici le résultat brut de la requête 2.2)_

```
<résultat à coller>
```

## Patterns RLS recommandés (référence)

### Lecture profile + group co-owned

```sql
CREATE POLICY "user can read own and group data"
  ON estimated_budgets
  FOR SELECT
  USING (
    profile_id = auth.uid()
    OR group_id IN (
      SELECT group_id FROM group_members WHERE user_id = auth.uid()
    )
  );
```

### Écriture personne uniquement

```sql
CREATE POLICY "user can write own data only"
  ON estimated_budgets
  FOR INSERT
  WITH CHECK (profile_id = auth.uid());
```

## Notes Sprint 0

- Aucune correction de policy n'est appliquée ici (hors-scope du Sprint 0). Toute lacune détectée alimente un futur sprint dédié.
- L'application utilise actuellement `supabase-server.ts` avec la **service role key** qui bypasse RLS — donc les défauts de RLS ne sont pas exploités côté serveur. Ils deviennent critiques si la `anon` key est jamais utilisée pour lire/écrire ces tables, ce qui est actuellement le cas du client (`supabase-client.ts`).
- Le pull du schéma pourra ajouter une migration `*_remote_schema.sql` versionnée à côté de `20260506000000_create_finance_rpcs.sql`.
