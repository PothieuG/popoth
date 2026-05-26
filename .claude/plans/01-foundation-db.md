# Sprint 01 — Foundation DB

> ✅ **LIVRÉ 2026-05-26** sur branche `feature/projets-epargne`, commit `97eceee`. Détails closeout → [Part 29](../history/roadmap-detailed-29-projets-epargne.md). Migration `20260601000000_create_savings_projects.sql` appliquée sur dev (`ddehmjucyfgyppfkbddr`) ; prod différée sprint 11. `EXPECTED_RPCS` 21 → 25, fn versionnées 30 → 34.

> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet (3 sections : entité projet, intégration RAV, intégration Monthly Recap).

## Objectif

Créer la table `savings_projects` + 4 RPCs atomiques CRUD + RLS, en miroir des patterns existants pour `estimated_budgets` et `piggy_bank`. Régénérer les types TypeScript. Mettre à jour le pin `EXPECTED_RPCS`.

## Décisions produit clés (déjà validées)

- **Cumul mensuel** : à la fin du recap mensuel (pas de cron — accumulation atomique via RPC composite à la finalize).
- **Décalage d'échéance partiel** : fractionnaire arrondi. Stocker `pending_delay_fraction NUMERIC DEFAULT 0` ; quand `pending + frac_added ≥ 1`, shift deadline de `FLOOR(...)` mois et garder la fraction résiduelle. Refund total ⇒ +1 mois directement.
- **Cascade dépense overflow** : projets sanctuarisés (cascade auto-piggy NE touche pas les projets).
- **Contexte** : perso + groupe (pattern owner-row `profile_id | group_id`).

## Pré-lecture obligatoire

- [supabase/migrations/20260520120000_*.sql](../../supabase/migrations/) — RPC `delete_budget_with_savings_transfer` (pattern à mimer exactement pour `delete_savings_project_to_piggy`)
- [supabase/migrations/20260506000000_create_finance_rpcs.sql](../../supabase/migrations/20260506000000_create_finance_rpcs.sql) — conventions RPC (`SECURITY DEFINER`, `REVOKE/GRANT`, `SET search_path`, `NOTIFY pgrst`)
- [scripts/check-rpcs.mjs](../../scripts/check-rpcs.mjs) — le pin `EXPECTED_RPCS = 21` doit passer à 25
- [.claude/conventions/git-workflow.md §11 RPC conventions](../conventions/git-workflow.md)

## Tâches

### 1. Préparer la branche + cibler la DB dev

```powershell
git checkout -b feature/projets-epargne cleanup
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'   # DB dev (cf. memory feedback_supabase_project_target)
```

### 2. Créer la migration

Nouveau fichier `supabase/migrations/<TS>_create_savings_projects.sql` :

```sql
CREATE TABLE savings_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) >= 2),
  target_amount NUMERIC(12,2) NOT NULL CHECK (target_amount > 0),
  monthly_allocation NUMERIC(12,2) NOT NULL CHECK (monthly_allocation > 0),
  deadline_date DATE NOT NULL,
  amount_saved NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_saved >= 0),
  pending_delay_fraction NUMERIC(6,4) NOT NULL DEFAULT 0
    CHECK (pending_delay_fraction >= 0 AND pending_delay_fraction < 1),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((profile_id IS NULL) != (group_id IS NULL))
);

CREATE INDEX savings_projects_profile_idx
  ON savings_projects(profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX savings_projects_group_idx
  ON savings_projects(group_id) WHERE group_id IS NOT NULL;

-- RLS : reprendre VERBATIM les 4 policies de estimated_budgets (SELECT/INSERT/UPDATE/DELETE)
-- en remplaçant "estimated_budgets" → "savings_projects" partout
ALTER TABLE savings_projects ENABLE ROW LEVEL SECURITY;
-- ... policies à copier depuis le baseline ...
```

### 3. 4 RPCs atomiques (mêmes conventions : `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO service_role`, `NOTIFY pgrst, 'reload schema'`)

- **`create_savings_project(p_name, p_target, p_monthly, p_deadline, p_profile_id, p_group_id) RETURNS json`** — INSERT atomic. Return la row entière en json. Validate `(p_profile_id IS NULL) != (p_group_id IS NULL)`.

- **`update_savings_project(p_id, p_name, p_target, p_monthly, p_deadline, p_profile_id, p_group_id) RETURNS json`** — UPDATE atomic (lock SELECT FOR UPDATE → check ownership matches → UPDATE → return row). Ne touche PAS `amount_saved` ni `pending_delay_fraction`.

- **`delete_savings_project_to_piggy(p_id, p_profile_id, p_group_id) RETURNS json`** — Clone EXACT de `delete_budget_with_savings_transfer` (20260520120000) :
  1. Lock + SELECT amount_saved + check ownership
  2. UPSERT piggy_bank.amount += amount_saved (partial unique index par owner)
  3. DELETE savings_projects WHERE id = p_id
  4. Return `json_build_object('transferred_amount', X, 'piggy_amount', Y)`

- **`apply_recap_projects_snapshot(p_recap_id, p_allocations json) RETURNS json`** — Appliqué à la finalize du recap (sprint 10). **Sémantique au sprint 10** (cf. plan principal) : itère sur **TOUS les projets actifs de l'owner** (résolu via `monthly_recaps.profile_id|group_id`), refund = `COALESCE(p_allocations->>id, 0)`. Pour chaque projet :
  - `frac_added := refund / monthly_allocation`
  - `new_pending := pending_delay_fraction + frac_added`
  - `months_to_shift := FLOOR(new_pending)`
  - `IF months_to_shift >= 1 THEN deadline_date += INTERVAL '1 month' * months_to_shift; pending_delay_fraction := new_pending - months_to_shift; ELSE pending_delay_fraction := new_pending; END IF`
  - `amount_saved += (monthly_allocation - refund)`
  - Return `json_build_object('updated_count', N, 'total_refunded', X)`

### 4. Mettre à jour `scripts/check-rpcs.mjs`

`EXPECTED_RPCS = 21 → 25` ; ajouter les 4 nouvelles entrées dans la liste pinnée.

### 5. Appliquer + valider

```powershell
node scripts/apply-sql.mjs supabase/migrations/<TS>_create_savings_projects.sql
pnpm supabase migration repair --status applied <TS>
node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
pnpm db:types
pnpm db:check-drift          # exit 0
pnpm db:check-rpcs           # exit 0 (25 RPCs)
pnpm db:audit-functions      # aucun drift
pnpm typecheck               # exit 0
```

### 6. Commit

```
feat(db): add savings_projects table + 4 atomic RPCs
```

## Acceptance criteria

- 4 nouvelles RPCs visibles dans `pg_proc` (vérifiable via `pnpm db:check-rpcs`).
- `lib/database.types.ts` contient `Database['public']['Tables']['savings_projects']`.
- 0 drift baseline ↔ prod (sur dev — la prod sera pushée à la fin de la feature, sprint 11).
- 0 lint warning / 0 type error.

## Hors scope (sprints suivants)

- Aucun handler API, aucun hook, aucune UI.
- Aucun test gated (les tests RPC suivent au sprint 02).
- Pas de push prod (uniquement dev — prod au sprint 11 via push gate).
