# Part 37 — Group-Income-Cascade (revenus estimés groupe → recalcul auto des contributions)

> Sprint livré 2026-05-28 sur branche `dev`. Feature parente : sur le dashboard d'un
> groupe, les revenus saisis dans l'onglet "Revenus" du planificateur **réduisent
> automatiquement les contributions** de chaque membre (miroir inverse du budget,
> Sprint Group-Budget-Auto-Sync 2026-05-19). Surplus (revenus > budgets) → contributions
> clampées à 0 et surplus en cagnotte (visible via RAV groupe positif).

## Contexte

Aujourd'hui sur le dashboard groupe, l'onglet "Revenus" du `PlanningDrawer` permet
déjà d'ajouter un revenu estimé via `AddIncomeDialog` (route POST
`/api/finance/incomes?context=group` insère bien avec `group_id`, hook
`useIncomes('group')` ContextFilter-aware). **Mais la sémantique métier était cassée** :

- L'ajout d'un revenu estimé groupe gonflait le **RAV groupe** (via
  `calculateIncomeCompensation('group')` qui filtre déjà par `group_id`).
- L'ajout d'un revenu estimé groupe **ne réduisait PAS les contributions** des
  membres : le trigger `trigger_group_budget_change` ne fire que sur UPDATE de
  `groups.monthly_budget_estimate`, jamais sur `estimated_incomes`.

Décision user (planning 2026-05-28) :

- **Surplus** : option "Personne ne paye, surplus en cagnotte" (clamp à 0 dans le
  calcul de contribution). Rejette "contributions négatives" (étrange) et "saisie
  bloquée" (trop strict).
- **UI** : déjà en place (onglet Revenus + bouton "Ajouter un revenu"). Étendre
  `AddIncomeDialog` / `EditIncomeDialog` avec props groupe, pas de nouvelle modal.

## Sémantique mathématique (vérifiée)

Notations : `B` = `SUM(estimated_budgets WHERE group_id=X)` + projets ; `R` =
`SUM(estimated_incomes WHERE group_id=X)` ; `X_i` = real_income_entries du groupe.

**Contributions** (clamp à 0, miroir RPC PG) :

```
contribution_base = GREATEST(0, B − R)
contribution_i    = (salary_i / Σ salaires) × contribution_base
```

**RAV groupe** (formule canonique [calc-rtl.ts:58-73](../../lib/finance/calc-rtl.ts), inchangée) :

```
RAV_group = incomeContribution + exceptionalIncomes + totalGroupContributions
          − estimatedBudgets − exceptionalExpenses − budgetDeficits
```

| Cas                 | Résultat                                        | Demande user                                          |
| ------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| Ajout R (sans real) | RAV = R + max(0,B−R) − B = 0 si R≤B, R−B si R>B | ✓ pas d'impact RAV à la création, surplus en cagnotte |
| Real X = R          | identique au cas précédent                      | ✓ no-op cohérent                                      |
| Real X < R          | RAV = X + max(0,B−R) − B = X−R<0                | ✓ moins de revenu → RAV↘                              |
| Real X > R          | RAV = X + max(0,B−R) − B = X−R>0                | ✓ plus de revenu → RAV↗                               |

## Migrations DB (4 migrations, ordre OBLIGATOIRE)

Pattern de référence verbatim : [supabase/migrations/20260520000000_auto_sync_group_budget.sql](../../supabase/migrations/20260520000000_auto_sync_group_budget.sql) (Sprint Group-Budget-Auto-Sync).

**M1 — `20260607000000_add_monthly_income_estimate_to_groups.sql`** : `ALTER TABLE
groups ADD COLUMN monthly_income_estimate numeric(10,2) NOT NULL DEFAULT 0`.
NOTIFY pgrst.

**M2 — `20260607000001_update_calculate_group_contributions_with_income.sql`** :
`CREATE OR REPLACE FUNCTION calculate_group_contributions(uuid)` cloné verbatim du
body original ([20260512000000:38-119](../../supabase/migrations/20260512000000_capture_trigger_functions.sql))
avec 3 ajustements minimaux :

- Déclare `group_income` + `contribution_base`.
- SELECT enrichi `monthly_budget_estimate, monthly_income_estimate`.
- `contribution_base := GREATEST(0, group_budget − COALESCE(group_income, 0))`.
- Toutes les formules `contribution_amount` (2 branches : split-égal `total_salaries=0`
  et prorata) utilisent `contribution_base` à la place de `group_budget`.
- Variable `total_salaries` réutilisée comme COUNT en branche fallback — pattern legacy
  préservé pour ne pas diverger du contrat existant (cf. critique Plan agent).

**M3 — `20260607000002_sync_group_monthly_income_estimate.sql`** : miroir verbatim
de M3 budget. Fonction `sync_group_monthly_income_estimate()` + trigger
`estimated_incomes_sync_group_income` AFTER INSERT OR UPDATE OR DELETE ON
`estimated_incomes`. Mêmes guards (`new_group IS NULL AND old_group IS NULL`
early-return ; `IS DISTINCT FROM` sur UPDATE). Backfill UPDATE des groupes
existants.

**M4 — `20260607000003_recalc_contributions_on_income_change.sql`** : trigger
`groups_income_contribution_recalc` AFTER UPDATE OF `monthly_income_estimate` ON
`groups` → `PERFORM calculate_group_contributions(NEW.id)`. Miroir du trigger
existant `trigger_group_budget_change` ([20260512000000:124-136](../../supabase/migrations/20260512000000_capture_trigger_functions.sql)).
Fonction `trigger_group_income_change()` dédiée (séparée de
`trigger_group_budget_change` pour lisibilité audits via `pg_trigger`). Garde
`IS DISTINCT FROM` null-safe vs `!=`.

**Cascade complète post-feature** :

```
estimated_incomes INSERT/UPDATE/DELETE (group_id != null)
→ M3 trigger sync_group_monthly_income_estimate
→ groups.monthly_income_estimate UPDATE (si DISTINCT)
→ M4 trigger groups_income_contribution_recalc
→ calculate_group_contributions(X) (M2 modifiée)
→ UPSERT group_contributions (contribution_amount baisse)
→ Sprint 16 V3 trigger sync_contribution_real_expense → real_expenses miroir UPDATE
→ Sprint 16 V3 trigger auto_devalidate_contribution_on_amount_change → si applied :
                                                                       restitue solde + reset applied_at
→ Sprint 36 trigger sync_contribution_real_income → real_income_entries miroir UPDATE
```

**Note user-visible** : si un membre avait validé sa contribution (long-press apply),
la baisse de `contribution_amount` déclenche `auto_devalidate_contribution_on_amount_change`
([20260528030000](../../supabase/migrations/20260528030000_auto_devalidate_contribution_on_amount_change.sql))
→ solde restitué + contribution remarquée "à valider". Cohérent sémantiquement
(la dépense miroir doit refléter le nouveau montant), mais le membre verra son
state changer post-ajout d'un revenu groupe par un coéquipier.

## Front-end

**Nouveau pure module** : [lib/finance/group-members-contributions-preview.ts](../../lib/finance/group-members-contributions-preview.ts)
— miroir conceptuel inverse de `group-members-rav-preview.ts`. Exports
`computeProjectedGroupIncomeTotal({ currentGroupIncomeTotal, currentItemAmount?,
newItemAmount })` (delta-math add/edit) et `computeGroupMembersContributionsPreview({
members, currentGroupBudgetTotal, currentGroupIncomeTotal, projectedGroupIncomeTotal
})` (par membre : `currentContribution`, `projectedContribution`, `delta` < 0 si
baisse). Match exact de la logique PG M2 (mêmes branches split-égal vs prorata, même
clamp `Math.max(0, B − R)`).

**Nouveau composant UI** : [components/dashboard/GroupMembersContributionsRecap.tsx](../../components/dashboard/GroupMembersContributionsRecap.tsx)
— pattern visuel miroir de `GroupMembersRavRecap`. Header "Impact sur les
contributions" + 1 ligne par membre (`currentContribution → projectedContribution`
avec delta vert si baisse, gris si no-op). Footer 2 variantes selon
`projectedGroupSurplus > 0` : "Surplus groupe : X€ en cagnotte" ou "Le reste-à-vivre
du groupe n'est pas affecté".

**Extension `AddIncomeDialog`** ([components/dashboard/AddIncomeDialog.tsx](../../components/dashboard/AddIncomeDialog.tsx)) :
4 nouvelles props optionnelles (`context?: 'profile' | 'group'`, `groupMembersRav?`,
`currentGroupBudgetTotal?`, `currentGroupIncomeTotal?`). En `context === 'group'`,
le panel preview perso "Calcul des revenus totaux" est remplacé par
`<GroupMembersContributionsRecap>`. useMemo pour calculer `groupContribRows` (même
pattern que AddBudgetDialog).

**Extension `EditIncomeDialog`** : symétrique avec `currentItemAmount = income.estimated_amount`
soustrait avant d'ajouter `previewSafe` (delta-math en mode édition).

**`PlanningDrawer`** : calcul `currentGroupIncomeTotal = isGroupContext ? totalIncomes
: undefined` + forward les 4 props à `<AddIncomeDialog>` (ligne 1129) et
`<EditIncomeDialog>` (ligne 1171). `currentGroupBudgetTotal = totalBudgets +
totalMonthlyAllocations` (= `currentGroupTotal` existant qui pilote
`monthly_budget_estimate`).

## Backend libs (aucun changement nécessaire)

Tous les fichiers backend sont déjà ContextFilter-aware :

- [lib/finance/income-compensation.ts](../../lib/finance/income-compensation.ts) — somme déjà `estimated_incomes` filtrés par owner column.
- [lib/finance/financial-data.ts](../../lib/finance/financial-data.ts) — `totalEstimatedIncome` agrège correctement groupe vs perso.
- [lib/api/finance/incomes.ts](../../lib/api/finance/incomes.ts) — POST `?context=group` insère déjà avec `group_id` set + `saveRemainingToLiveSnapshot`.
- [lib/finance/planner-emptiness.ts](../../lib/finance/planner-emptiness.ts) — `estimated_incomes` déjà dans `PLANNER_TABLES`, donc verrouillage salaire groupe gratuit.

## Tests

**+12 unit non-gated** ([lib/finance/**tests**/group-members-contributions-preview.test.ts](../../lib/finance/__tests__/group-members-contributions-preview.test.ts))
— miroir des tests `group-members-rav-preview.test.ts`. 3 cas
`computeProjectedGroupIncomeTotal` (add/edit/edit-down) + 9 cas
`computeGroupMembersContributionsPreview` (happy prorata, surplus clamp, split-égal,
édition vers le bas, delta nul, budget vide, membres vides, mélange salaires
zéro+non-zéro).

**+6 gated cascade** ([lib/finance/**tests**/group-income-cascade.test.ts](../../lib/finance/__tests__/group-income-cascade.test.ts),
`SUPABASE_FINANCE_TESTS=1`) — valide la cascade end-to-end DB sur un fixture
2 membres (Alice 3000€, Bob 2000€) + budget groupe 1000€ :

1. **baseline** — sans revenu, contributions = 600/400 (prorata × 1000).
2. **M1 add R=300** — `monthly_income_estimate ← 300`, contributions = 420/280
   (prorata × 700).
3. **M2 edit R=300→700** — contributions = 180/120 (prorata × 300).
4. **M3 surplus R=1500** — contributions = 0/0, RAV groupe = 500 (cagnotte).
5. **M4 real X > estimé** — contributions stables (basées sur estimé), RAV bouge
   du delta de compensation.
6. **M5 delete R** — `monthly_income_estimate ← 0`, contributions remontent à
   600/400.

**Mises à jour test existant** : [lib/finance/**tests**/financial-data.test.ts](../../lib/finance/__tests__/financial-data.test.ts)
cases 2 (group golden) et 5 (fail-soft empty) — GOLDEN_GROUP enrichi avec
`totalGroupContributions: 0` + `groupMembersRav` + `groupMembersPersonalRavTotal`
(fields ajoutés par Sprints Group-RAV-Recap 2026-05-27 + Fix-Group-Recap-RavEstime
qui n'avaient pas mis à jour ce test gated). Sprint Group-Income-Cascade les
matérialise via la cascade R=1000 > B=600 = surplus → contribution = 0 → RAV = 400
(au lieu de 1000 pre-feature). GROUP_EMPTY_SHAPE ajoute `totalGroupContributions: 0`.

**Pre-existing failure non-related** : `financial-data-with-projects.test.ts` case 2
(`group + 1 project 50€/month`) cassé depuis Sprint PÉ-12 ([20260604000000_sync_group_budget_on_project_change.sql](../../supabase/migrations/20260604000000_sync_group_budget_on_project_change.sql))
qui propage les projets dans `monthly_budget_estimate` — l'assertion `withProject.remainingToLive
=== baselineRav - 50` n'a plus de sens (contribution = budget = la baisse de RAV est
compensée). Out-of-scope du sprint Group-Income-Cascade. À fixer dans un sprint
follow-up dédié.

## Décisions produit clés (planning 2026-05-28)

1. **Surplus → contributions = 0, surplus en cagnotte** (Q1) — rejette "négatives"
   (étrange) et "saisie bloquée" (trop strict).
2. **UI déjà en place** (Q2 redirigé) — l'onglet Revenus du PlanningDrawer existe
   depuis Sprint Read-Only-Virtual-Rows-V3 (Part 36). Pas de nouvelle modal,
   étension des dialogs existants.
3. **Pas de snapshot recap `income_snapshot_data`** (décision Plan) — suit le
   pattern actuel (les `estimated_incomes` ne sont pas figées pendant le wizard,
   identique au comportement perso). Risque résiduel : si membre A modifie un
   revenu groupe pendant que membre B est dans son wizard, contributions live
   changeront → real_expense miroir auto-devalidée. À monitorer en QA.

## Vérification

- `pnpm typecheck` exit 0.
- `pnpm lint:check` 0/0.
- `pnpm format:check` — 3 pré-existants `scripts/seed-recap/*.mjs` (sprint
  `dde4ce9`), aucun warning sur mes nouveaux fichiers.
- `pnpm test:run` 812 passants (+12 non-gated, baseline 800).
- `pnpm test:run` avec `SUPABASE_FINANCE_TESTS=1` : 853 passants (+6 gated mine
  - 35 autres gated) + 1 fail pré-existant (financial-data-with-projects case 2,
    cf. ci-dessus).
- `pnpm db:audit-functions` exit 0 sur dev : 43 fonctions versionnées (était 41,
  +2 nouvelles `sync_group_monthly_income_estimate` + `trigger_group_income_change`).

## Migrations DB déployées (dev `ddehmjucyfgyppfkbddr`)

```
20260607000000_add_monthly_income_estimate_to_groups.sql
20260607000001_update_calculate_group_contributions_with_income.sql
20260607000002_sync_group_monthly_income_estimate.sql
20260607000003_recalc_contributions_on_income_change.sql
```

⚠️ **Particularité push CLI** : `pnpm supabase db push --include-all` a marqué les 4
migrations comme `applied` dans `schema_migrations` MAIS n'a pas exécuté le SQL
(cas 3 du CLAUDE.md §7.5 — "tracker dit `applied` mais SQL jamais runné"). Fallback :
ré-application directe via `node scripts/apply-sql.mjs supabase/migrations/<file>` pour
chacune. État DB validé post-fix via 3 queries séparées (column exists, M2 body contains
`monthly_income_estimate`, M3+M4 functions present, triggers present, backfill drift = 0
rows).

À pousser vers prod après merge `dev → main` (cf. CLAUDE.md §7 push gate). `pnpm db:types`
à régénérer depuis prod post-push pour réaligner `lib/database.types.ts` (régénéré
depuis dev dans cette session — Sprint multi-env CLAUDE.md §10 prévoit un dernier
regen prod avant release pour `db:check-types-fresh` exit 0).
