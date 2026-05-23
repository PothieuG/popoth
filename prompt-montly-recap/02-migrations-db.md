# [02] — Migrations DB V3 : monthly_recaps + flag carry-over

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3, processus mensuel obligatoire avec wizard 5 écrans, état persisté pour resume après déconnexion, lock groupe, snapshot différé.
- Position dans la séquence : étape 02/17
- Dépend de : 01 (clean slate)
- Débloque : 03 (state lib), 04 (calculations), tous les autres prompts

## Objectif
Créer le schéma DB V3 from scratch : table `monthly_recaps` (avec state machine + lock + refloats tracking + snapshot JSONB) et colonnes `is_carried_over` / `carried_from_recap_id` sur `real_expenses` + `real_income_entries`. Pas de table `recap_snapshots` séparée — toutes les données interim vivent dans `monthly_recaps.snapshot_data` JSONB. Régénérer les types TypeScript.

## Fichiers concernés
- `supabase/migrations/<TS>_create_monthly_recaps_v3.sql` — à créer
- `supabase/migrations/<TS>_add_carry_over_flags.sql` — à créer (séparé pour rollback granulaire)
- `lib/database.types.ts` — régénéré automatiquement via `pnpm db:types`
- `scripts/check-rpcs.mjs` — pas de modif maintenant (RPCs ajoutés en 06/07/15)

## Patterns et conventions à respecter
- **Nommage SQL** : snake_case partout, suffix `_at` pour timestamptz, `_id` pour FK uuid (cf. CLAUDE.md §6 Naming).
- **RLS désactivée** : aucune des tables financières n'a RLS active (toutes accédées via service_role). `monthly_recaps` suit le même pattern.
- **Triggers `updated_at`** : utiliser le pattern existant — chercher dans `supabase/migrations/` un exemple (`bank_balances` ou `estimated_budgets`) pour copier le trigger function pattern.
- **UNIQUE constraints** : 2 contraintes partielles obligatoires (UNIQUE WHERE profile_id IS NOT NULL + UNIQUE WHERE group_id IS NOT NULL).
- **FK ON DELETE** : `profile_id` + `group_id` + `started_by_profile_id` en `ON DELETE CASCADE` (recap disparaît avec le user/groupe) ; `carried_from_recap_id` en `ON DELETE SET NULL` (préserver la transaction si le recap est supprimé).
- **Pattern migration** : `node scripts/apply-sql.mjs <file>` puis `migration repair --status applied` puis re-export baseline puis `pnpm db:check-drift`. Cf. [.claude/conventions/git-workflow.md](../.claude/conventions/git-workflow.md) §5.
- **NOTIFY pgrst** : à la fin de chaque migration pour que PostgREST relise le schema cache.

## Schéma cible

### Table `monthly_recaps` (V3 fresh)
```sql
CREATE TABLE monthly_recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contexte (exactly one of profile_id / group_id non-null, enforced via CHECK)
  profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  group_id   uuid REFERENCES groups(id)   ON DELETE CASCADE,
  CHECK ((profile_id IS NOT NULL) <> (group_id IS NOT NULL)),

  -- Période
  recap_month smallint NOT NULL CHECK (recap_month BETWEEN 1 AND 12),
  recap_year  smallint NOT NULL CHECK (recap_year  BETWEEN 2024 AND 2100),

  -- State machine
  current_step text NOT NULL DEFAULT 'welcome'
    CHECK (current_step IN ('welcome','summary','manage_bilan','salary_update','final_recap','completed')),

  -- Lock (initiateur en contexte groupe)
  started_by_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  started_at  timestamptz,

  -- Refloats tracking (cumulés, mis à jour à chaque action immédiate)
  refloated_from_piggy   numeric(14,2) NOT NULL DEFAULT 0,
  refloated_from_savings numeric(14,2) NOT NULL DEFAULT 0,

  -- Snapshot différé : { budget_id: amount, ... } pour le puisage proportionnel ligne 3 (§4.B)
  budget_snapshot_data jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Finalisation
  completed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE partiel par contexte
CREATE UNIQUE INDEX monthly_recaps_profile_unique
  ON monthly_recaps (profile_id, recap_month, recap_year)
  WHERE profile_id IS NOT NULL;

CREATE UNIQUE INDEX monthly_recaps_group_unique
  ON monthly_recaps (group_id, recap_month, recap_year)
  WHERE group_id IS NOT NULL;

-- Index lookup pour le check-status (proxy)
CREATE INDEX monthly_recaps_completed_lookup
  ON monthly_recaps (profile_id, group_id, recap_month, recap_year, completed_at);

-- Trigger updated_at
CREATE TRIGGER monthly_recaps_set_updated_at
  BEFORE UPDATE ON monthly_recaps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Colonnes carry-over sur transactions
```sql
ALTER TABLE real_expenses
  ADD COLUMN is_carried_over boolean NOT NULL DEFAULT false,
  ADD COLUMN carried_from_recap_id uuid REFERENCES monthly_recaps(id) ON DELETE SET NULL;

CREATE INDEX real_expenses_carried_over_idx
  ON real_expenses (profile_id, group_id, is_carried_over)
  WHERE is_carried_over = true;

ALTER TABLE real_income_entries
  ADD COLUMN is_carried_over boolean NOT NULL DEFAULT false,
  ADD COLUMN carried_from_recap_id uuid REFERENCES monthly_recaps(id) ON DELETE SET NULL;

CREATE INDEX real_income_entries_carried_over_idx
  ON real_income_entries (profile_id, group_id, is_carried_over)
  WHERE is_carried_over = true;
```

## Étapes d'implémentation suggérées
1. **Vérifier `set_updated_at()` existe** : `Grep "CREATE.*FUNCTION set_updated_at"` dans `supabase/migrations/`. Si non, copier le pattern depuis une table financière qui l'utilise.
2. **Créer migration 1** : `supabase/migrations/<TS>_create_monthly_recaps_v3.sql` avec le bloc `monthly_recaps`. Ajouter `NOTIFY pgrst, 'reload schema';` à la fin.
3. **Créer migration 2** : `supabase/migrations/<TS>_add_carry_over_flags.sql` avec les `ALTER TABLE`. Ajouter `NOTIFY pgrst, 'reload schema';`.
4. **Appliquer m1** : `node scripts/apply-sql.mjs supabase/migrations/<TS1>_create_monthly_recaps_v3.sql` → `pnpm supabase migration repair --status applied <TS1>`.
5. **Appliquer m2** : `node scripts/apply-sql.mjs supabase/migrations/<TS2>_add_carry_over_flags.sql` → `pnpm supabase migration repair --status applied <TS2>`.
6. **Re-export baseline** : `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql`.
7. **Régénérer types** : `pnpm db:types`.
8. **Vérifs** : `pnpm db:check-drift`, `pnpm db:check-types-fresh`, `pnpm typecheck`.
9. **Commit** : un commit par migration ou groupé `feat(recap): create monthly_recaps V3 + carry-over flags`.

## Critères d'acceptation
- [ ] Table `monthly_recaps` créée avec toutes les colonnes du schéma cible
- [ ] CHECK constraint XOR profile_id/group_id active
- [ ] UNIQUE indexes partiels créés (1 par contexte)
- [ ] Trigger `updated_at` actif
- [ ] Colonnes `is_carried_over` + `carried_from_recap_id` ajoutées sur `real_expenses` ET `real_income_entries`
- [ ] Indexes partiels `WHERE is_carried_over = true` créés
- [ ] `lib/database.types.ts` régénéré, contient le type `monthly_recaps` avec tous les champs
- [ ] `pnpm db:check-drift` exit 0
- [ ] `pnpm db:check-types-fresh` exit 0
- [ ] `pnpm typecheck` exit 0
- [ ] Migration enregistrée dans `supabase_migrations` (vérifier via `pnpm supabase migration list`)

## Tests à écrire
Aucun test app pour cette tâche (DDL pure). Optionnel : tester le CHECK constraint via une insertion test (devrait throw), mais c'est plus pour le développeur que pour la CI.

## Pièges et points d'attention
- **Ne PAS utiliser `supabase db push`** pour appliquer ces migrations — collision possible si supabase CLI tente de re-créer des objets. Pattern obligatoire : `apply-sql.mjs` + `migration repair --status applied`.
- **CHECK XOR** : `(profile_id IS NOT NULL) <> (group_id IS NOT NULL)` est l'idiome PG pour "exactement un des deux". `XOR` n'existe pas en SQL standard.
- **Smallint vs integer** pour `recap_month`/`recap_year` : smallint est suffisant (1-12, 2024-2100) et compact. Si tu hésites, integer marche aussi.
- **Type `text` + CHECK** pour `current_step` plutôt que ENUM : ENUM PG est rigide (ALTER TYPE ADD VALUE n'est plus transactional après PG 12, mais reste lourd à muter). Pattern `text + CHECK` est utilisé partout dans le repo (cf. `estimated_budgets.is_monthly_recurring` est un bool, mais pour les enums string look `groups.type` ou similaire).
- **DEFAULT '{}'::jsonb** : nécessaire pour que les inserts initiaux ne plantent pas sur NULL. JSONB vide est OK pour les lookups.
- **Triggers `set_updated_at()`** : si la fonction n'existe pas globalement, créer-la dans la même migration ou se référer au pattern existant ([supabase/migrations/](../supabase/migrations/) `Grep "set_updated_at"`).
- **Régénérer types AVANT typecheck** : sinon TS rage sur la table inconnue. Les types `monthly_recaps` doivent apparaître dans `Database['public']['Tables']`.
- **FK `carried_from_recap_id` ON DELETE SET NULL** : si un recap est supprimé pour debug, les transactions reportées ne disparaissent pas — elles perdent juste leur lien. Préserve les données user.
- **NE PAS oublier `NOTIFY pgrst, 'reload schema';`** à la fin de chaque migration sinon PostgREST ne voit pas les nouvelles tables/colonnes pour les requêtes via `.from()` côté app.

## Commandes utiles
```bash
# Appliquer migrations
node scripts/apply-sql.mjs supabase/migrations/<TS1>_create_monthly_recaps_v3.sql
pnpm supabase migration repair --status applied <TS1>
node scripts/apply-sql.mjs supabase/migrations/<TS2>_add_carry_over_flags.sql
pnpm supabase migration repair --status applied <TS2>

# Re-export baseline + types
node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
pnpm db:types

# Vérifs
pnpm db:check-drift
pnpm db:check-types-fresh
pnpm typecheck
```

## Definition of Done
- Tous les critères d'acceptation cochés
- Les 2 migrations sont en place, appliquées, re-baselined
- `lib/database.types.ts` contient `monthly_recaps` avec toutes les colonnes
- `git diff lib/database.types.ts` montre l'ajout du type
- Commit `feat(recap): create monthly_recaps V3 + carry-over flags`
- `pnpm verify` exit 0
