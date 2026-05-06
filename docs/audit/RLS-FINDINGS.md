# Audit RLS Supabase — État initial

**Date** : 2026-05-06
**Scope** : Sprint 0 / item C4
**Projet** : `jzmppreybwabaeycvasz`
**Méthode** : requêtes `pg_policies` / `pg_tables` exécutées via l'API Management Supabase (`POST /v1/projects/{ref}/database/query`) avec un SUPABASE_ACCESS_TOKEN. `supabase db pull` / `db dump` ont été abandonnés car ils requièrent Docker Desktop sur Windows.

## Setup réalisé

- ✅ `pnpm supabase` (v2.98.2) installé en devDependencies.
- ✅ `pnpm supabase init` exécuté → `supabase/config.toml` créé.
- ✅ `pnpm supabase link --project-ref jzmppreybwabaeycvasz` exécuté → projet lié.
- ❌ `pnpm supabase db pull` requiert Docker (shadow DB locale). Non disponible sur ce poste.
- ❌ `pnpm supabase db dump` requiert aussi Docker (image bundlant `pg_dump`).
- ✅ Audit RLS effectué via l'API Management (4 requêtes `pg_policies`).

## Findings — résumé

### 🔴 Critique

1. **`piggy_bank` n'a PAS RLS activé et aucune policy.**
   N'importe quel client (anon ou authenticated) peut lire et écrire la tirelire de n'importe quel utilisateur via la REST API publique de Supabase. Combiné aux RPC atomiques ajoutées en C3, l'écriture serveur est sécurisée, mais le client direct ne l'est pas.
   **Action** : `ALTER TABLE piggy_bank ENABLE ROW LEVEL SECURITY;` puis créer policies équivalentes à `bank_balances` (`profile_id = auth.uid()` OR group via `profiles.group_id`).

2. **`group_contributions` policy ouverte aux authentifiés.**
   Policy `Authenticated users can manage contributions` avec `USING (auth.uid() IS NOT NULL)` — tout utilisateur authentifié peut gérer toutes les contributions de tous les groupes. Une seconde policy `view contributions for their own group` existe mais elle est SHADOWED par la première (PostgreSQL fait OR entre les permissive policies).
   **Action** : supprimer la policy ouverte, garder uniquement la version restreinte au groupe + ajouter equivalents INSERT/UPDATE/DELETE.

3. **`remaining_to_live_snapshots.INSERT WITH CHECK true` ouvert au public.**
   Policy nommée "Service role can insert snapshots" mais le `roles` est `{public}` (et non `{service_role}`) → tout utilisateur authentifié peut insérer un snapshot pour n'importe quel `profile_id` ou `group_id`.
   **Action** : restreindre `roles` à `service_role` OU resserrer `WITH CHECK` à `profile_id = auth.uid() OR group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())`.

### 🟡 À examiner

4. **`groups` SELECT `USING true`** (policy "Users can view all groups").
   Tous les utilisateurs authentifiés voient tous les groupes. Probablement intentionnel pour le module de recherche, mais à valider — fuite de noms de groupes si présence de PII dans `groups.name` / `description`.

5. **`profiles` a 3 policies SELECT redondantes.**
   - "Users can view own profile" (public, `auth.uid() = id`)
   - "Users can read own profile" (authenticated, `id = auth.uid()`)
   - "Group members can see each other" (authenticated, group-based)
   Pas un risque, mais à nettoyer (les 2 premières sont équivalentes).

6. **`profiles` n'a PAS de policy DELETE.**
   En RLS strict, l'absence de policy = interdiction. Confirmer si la suppression de profil est gérée côté admin uniquement.

### 🟢 OK

- Toutes les autres tables (`bank_balances`, `budget_transfers`, `estimated_budgets`, `estimated_incomes`, `monthly_recaps`, `real_expenses`, `real_income_entries`, `recap_snapshots`) ont RLS activé + policies cohérentes (own profile OR group members).
- Pas de table `group_members` séparée — l'appartenance est portée par `profiles.group_id` (relation N-to-1, pas N-to-N).

## Matrice RLS

| Table | RLS | SELECT | INSERT | UPDATE | DELETE | Dangereux ? |
|---|---|---|---|---|---|---|
| `bank_balances` | ✅ | ✅ ALL | ✅ ALL | ✅ ALL | ✅ ALL | — |
| `budget_transfers` | ✅ | 2 policies | 2 policies | 1 policy | 1 policy | — |
| `estimated_budgets` | ✅ | ALL ×2 | ALL ×2 | ALL ×2 | ALL ×2 | — |
| `estimated_incomes` | ✅ | ALL ×2 | ALL ×2 | ALL ×2 | ALL ×2 | — |
| `group_contributions` | ✅ | 2 policies | ALL | ALL | ALL | 🔴 ALL ouvert aux authentifiés |
| `groups` | ✅ | 1 (`true`) | 1 | 1 | 1 | 🟡 SELECT public |
| `monthly_recaps` | ✅ | ALL ×2 | ALL ×2 | ALL ×2 | ALL ×2 | — |
| `piggy_bank` | ❌ | — | — | — | — | 🔴 RLS DÉSACTIVÉ |
| `profiles` | ✅ | 3 policies | 1 | 1 | ❌ aucune | 🟡 redondance + pas de DELETE |
| `real_expenses` | ✅ | ALL ×2 | ALL ×2 | ALL ×2 | ALL ×2 | — |
| `real_income_entries` | ✅ | ALL ×2 | ALL ×2 | ALL ×2 | ALL ×2 | — |
| `recap_snapshots` | ✅ | ALL ×2 | ALL ×2 | ALL ×2 | ALL ×2 | — |
| `remaining_to_live_snapshots` | ✅ | 2 policies | 1 (`true` 🔴) | — | — | 🔴 INSERT public ouvert |

## Inventaire complet des policies (snapshot 2026-05-06)

```
bank_balances
  - "Users can update their own bank balance" | ALL | qual=(auth.uid() = profile_id)
  - "Users can view their own bank balance"   | SELECT | qual=(auth.uid() = profile_id)

budget_transfers
  - "Users can delete their own budget transfers" | DELETE | (profile_id=auth.uid()) OR (group_id IN profiles)
  - "Users can create transfers for their recaps" | INSERT | with_check=monthly_recap_id IN ...
  - "Users can insert their own budget transfers" | INSERT | with_check=(profile_id=auth.uid() AND group_id IS NULL) OR group
  - "Users can view their own budget transfers"   | SELECT | (profile_id=auth.uid()) OR group
  - "Users can view transfers for their recaps"   | SELECT | monthly_recap_id IN ...
  - "Users can update their own budget transfers" | UPDATE | (profile_id=auth.uid()) OR group

estimated_budgets
  - "Group members can manage group budgets" | ALL | group_id IS NOT NULL AND group_id IN profiles
  - "Users can manage their own budgets"     | ALL | profile_id = auth.uid()

estimated_incomes
  - "Group members can manage group estimated incomes" | ALL | group-based
  - "Users can manage their own estimated incomes"     | ALL | profile_id = auth.uid()

group_contributions
  - "Authenticated users can manage contributions"     | ALL | auth.uid() IS NOT NULL  ⚠️ TOO OPEN
  - "Users can view contributions for their own group" | SELECT | EXISTS profiles WHERE id=auth.uid() AND group_id=...

groups (roles={authenticated} — pas {public})
  - "Creators can delete their groups" | DELETE | creator_id = auth.uid()
  - "Users can create groups"          | INSERT | with_check=(creator_id=auth.uid())
  - "Users can view all groups"        | SELECT | qual=true  ⚠️ PUBLIC
  - "Creators can update their groups" | UPDATE | creator_id = auth.uid()

monthly_recaps
  - "Group members can manage group monthly recaps" | ALL | group-based
  - "Users can manage their own monthly recaps"     | ALL | profile_id = auth.uid()

piggy_bank
  ⚠️ AUCUNE POLICY — RLS DÉSACTIVÉ

profiles
  - "Users can insert own profile"      | INSERT | with_check=(auth.uid() = id)
  - "Group members can see each other"  | SELECT | group-based (authenticated)
  - "Users can read own profile"        | SELECT | id = auth.uid() (authenticated)
  - "Users can view own profile"        | SELECT | auth.uid() = id (public)  — redondant
  - "Users can update own profile"      | UPDATE | auth.uid() = id

real_expenses
  - "Group members can manage group expenses" | ALL | group-based
  - "Users can manage their own expenses"     | ALL | profile_id = auth.uid()

real_income_entries
  - "Group members can manage group income entries" | ALL | group-based
  - "Users can manage their own income entries"     | ALL | profile_id = auth.uid()

recap_snapshots
  - "Group members can manage group recap snapshots" | ALL | group-based
  - "Users can manage their own recap snapshots"     | ALL | profile_id = auth.uid()

remaining_to_live_snapshots
  - "Service role can insert snapshots"                  | INSERT | with_check=true  ⚠️ roles={public}, pas {service_role}
  - "Users can view their group remaining to live snapshots" | SELECT | group-based
  - "Users can view their own remaining to live snapshots"   | SELECT | profile_id = auth.uid()
```

## Procédure de re-audit

Pour ré-exécuter l'audit (sans Docker), via l'API Management Supabase :

```bash
TOKEN="<your_supabase_access_token>"
PROJECT="jzmppreybwabaeycvasz"
URL="https://api.supabase.com/v1/projects/$PROJECT/database/query"

# Policies dangereuses
curl -s -X POST "$URL" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND (qual='true' OR with_check='true');"}'

# RLS status
curl -s -X POST "$URL" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"}'
```

## Patterns RLS recommandés (référence)

### Activer RLS sur `piggy_bank` (CRITIQUE)

```sql
ALTER TABLE piggy_bank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own piggy_bank"
  ON piggy_bank
  FOR SELECT
  USING (
    profile_id = auth.uid()
    OR (group_id IS NOT NULL AND group_id IN (
      SELECT group_id FROM profiles WHERE id = auth.uid()
    ))
  );

CREATE POLICY "Users can manage their own piggy_bank"
  ON piggy_bank
  FOR ALL
  USING (
    profile_id = auth.uid()
    OR (group_id IS NOT NULL AND group_id IN (
      SELECT group_id FROM profiles WHERE id = auth.uid()
    ))
  );
```

### Resserrer `group_contributions`

```sql
DROP POLICY "Authenticated users can manage contributions" ON group_contributions;

CREATE POLICY "Group members can manage their group contributions"
  ON group_contributions
  FOR ALL
  USING (
    group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())
  );
```

### Resserrer `remaining_to_live_snapshots.INSERT`

```sql
DROP POLICY "Service role can insert snapshots" ON remaining_to_live_snapshots;

-- Option A : restreindre au service_role
CREATE POLICY "Only service role can insert snapshots"
  ON remaining_to_live_snapshots
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Option B : autoriser le user authentifié pour ses propres snapshots
CREATE POLICY "Users can insert their own snapshots"
  ON remaining_to_live_snapshots
  FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    OR (group_id IS NOT NULL AND group_id IN (
      SELECT group_id FROM profiles WHERE id = auth.uid()
    ))
  );
```

## Notes Sprint 0

- Aucune correction de policy n'est appliquée ici (hors-scope du Sprint 0). Les 3 corrections critiques ci-dessus alimentent un Sprint dédié sécurité RLS.
- L'application utilise `lib/supabase-server.ts` avec la **service role key** qui bypasse RLS — donc les défauts de RLS ne sont pas exploités côté serveur. Ils deviennent critiques côté client (`lib/supabase-client.ts`) qui utilise la `anon` key et serait soumis à RLS. Le défaut RLS sur `piggy_bank` rend la table accessible au public via la REST API anonyme.
- Le dump complet du schéma (`pg_dump`) n'a pas été produit — Docker requis. Le schéma reste accessible via Studio ou via l'API Management `POST /database/query`.
