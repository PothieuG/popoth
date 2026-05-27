# Part 36 — Salary-Auto-At-Recap-Complete + Contribution-Income-Mirror

> Sprints livrés 2026-05-28. Couvre 2 features parentes : (1) création automatique
> d'un revenu salaire à la finalisation du recap mensuel solo + modal de
> vérification UX, (2) extension du Sprint 16 V3 (Contribution dépense virtuelle
> perso) avec un revenu miroir côté groupe synchronisé en permanence.

## Contexte

Aujourd'hui les sources de revenu (salaire solo, contributions groupe) existent
en **virtuel** uniquement (`FinancialData.meta.readOnlyIncomes`) — utilisées
dans la planning view pour calculer le RAV, mais ne matérialisent pas le flux
réel sur le solde bancaire. Décision produit : transformer ces sources en
**transactions réelles** qui :

- impactent le **solde bancaire** uniquement (pas le RAV qui reste alimenté
  par les virtuels — évite le double-comptage)
- peuvent être validées par long-press (pattern Sprint 23 V3)
- deviennent **read-only à vie** une fois créées (kebab masqué, guards 409)

Le scope se sépare en 2 mécanismes distincts avec des cycles de vie différents.

## Sprint Salary-Auto-At-Recap-Complete (Solo)

**Déclencheur** : RPC dans `executeCompleteRecap` (lib/recap/actions-finalize.ts),
étape 3.5 ajoutée entre `process_recap_transactions` et `UPDATE completed_at`,
solo uniquement (`context === 'profile'`).

**Architecture** :

- Migration `20260605000000_add_recap_origin_to_real_income_entries.sql` —
  colonne `recap_origin_id UUID NULL REFERENCES monthly_recaps(id) ON DELETE
  SET NULL` + partial unique index pour idempotence.
- Migration `20260605000001_create_salary_income_for_recap_rpc.sql` — RPC
  `create_salary_income_for_recap(p_recap_id, p_profile_id)` qui :
  - Skip silencieux si `profile.salary IS NULL OR ≤ 0` (cas étudiant /
    chômeur / congé sans solde) — décision user explicite.
  - INSERT idempotent avec `ON CONFLICT (recap_origin_id) DO NOTHING`.
  - `description = 'Salaire'`, `amount = profile.salary`, `is_exceptional = false`
    (pas de double-count avec virtuel `totalIncomeContribution`),
    `applied_to_balance_at = NULL` (non-validé), `created_by_profile_id =
    p_profile_id`.
- `lib/recap/actions-finalize.ts` étendu : appel fail-soft du RPC pour solo
  uniquement. Le mode groupe est no-op (le mécanisme miroir Sprint 16 V3
  étendu prend le relais — cf. §Contribution-Income-Mirror).
- Outcome `salaryIncome: { created, reason?, income_id?, amount? } | null`
  exposé via `CompleteRecapOutcome`.

**Modal de vérification UX** :

- Migration `20260605000002_create_validate_salary_with_delta_rpc.sql` — RPC
  atomique `validate_salary_with_delta(p_income_id, p_real_amount,
  p_created_by_profile_id)` qui :
  1. SELECT FOR UPDATE + assertions (`recap_origin_id NOT NULL`,
     `applied_to_balance_at IS NULL`, `profile_id NOT NULL`).
  2. Calcul `delta = ROUND(p_real_amount - row.amount, 2)` cents-precise.
  3. Toujours valide le salaire à son `amount` original
     (`applied_to_balance_at = NOW()`, `last_applied_amount = amount`,
     `is_carried_over = false` pour le badge "Mois précédent" qui disparait
     post-validation — pattern Part 35) + bank_balance += amount.
  4. Si `delta > 0` → INSERT + apply un revenu exceptionnel "Équilibrage salaire"
     à hauteur de delta. Bank balance += delta.
  5. Si `delta < 0` → INSERT + apply une dépense exceptionnelle "Équilibrage
     salaire" à hauteur de |delta|. Bank balance -= |delta|.
  6. Si `delta = 0` → rien de plus.
- Endpoint `POST /api/finance/income/real/validate-salary` — `withAuthAndProfile`,
  parseBody Zod (`validateSalaryBodySchema`), ownership check, pre-ensure
  `bank_balances` row, appel RPC. Codes 404/409 spécifiques :
  `salary-income-not-found`, `salary-already-validated`, `salary-row-mismatch`.
- Composant `components/dashboard/SalaryValidationModal.tsx` — Dialog Radix +
  DecimalFormInput pré-rempli (defaultAmount = ligne.amount), boutons
  Annuler/Confirmer, mutation `useValidateSalary`. Lazy-mount via
  `key={incomeId}` + `useState(() => defaultAmount)` lazy.
- Hook `useValidateSalary()` dans `hooks/useRealIncomes.ts` — POST + invalidate
  financial refreshes au succès.
- `lib/api/finance/income-real.ts` PUT/DELETE — guards 409
  `cannot-edit-recap-salary` / `cannot-delete-recap-salary` si `recap_origin_id
  != null` (read-only à vie, peu importe l'état de validation).
- `lib/api/finance/income-toggle-applied.ts` + `income-toggle-carry-applied.ts`
  — filet défense API direct : 409 `salary-validation-requires-modal` si le
  user appelle ces endpoints sur un salaire non-validé (force le passage par
  la modal). 409 `cannot-toggle-validated-recap-salary` si déjà validé.

**UI long-press routing** : `TransactionListItem.tsx` détecte
`isSalaryRow = type === 'income' && transaction.recap_origin_id != null`.
Quand `isApplied = false`, le long-press déclenche `setIsSalaryModalOpen(true)`
au lieu de l'appel direct `toggleAppliedToBalance`. Quand `isApplied = true`,
le long-press est inopérant (lock à vie). Kebab toujours masqué.

## Sprint Contribution-Income-Mirror (Groupe)

**Redirection scope** — initialement le user avait demandé de créer N revenus
non-validés au moment de la finalisation du recap groupe (1 par
`group_contributions`). Au planning, il a redirigé vers une approche miroir
permanent : étendre le Sprint 16 V3 (Contribution dépense virtuelle perso)
pour ajouter un revenu miroir côté groupe, synchronisé en permanence avec la
dépense user perso. Spec : « Si on valide la dépense côté utilisateur, le
revenu côté groupe devrait automatiquement être validé, et vice-versa. Et
le même message d'auto-devalidate (X€ à ajouter/retirer) doit apparaître des
2 côtés. »

**Architecture** :

- Migration `20260605000003_add_contribution_id_to_real_income_entries.sql` —
  colonne `contribution_id UUID NULL REFERENCES group_contributions(id) ON
  DELETE CASCADE` + partial unique index symétrique au sprint 16 V3 expense.
- Migration `20260605000004_create_contribution_real_income_triggers.sql` —
  2 triggers symétriques au sprint 16 V3 :
  - `sync_contribution_real_income` (AFTER INSERT/UPDATE on
    `group_contributions`) v2 avec auto-devalidate. UPSERT la row miroir
    côté groupe (`group_id = NEW.group_id`, `profile_id = NULL`,
    `description = 'Contribution de ' || first_name`, `amount =
    NEW.contribution_amount`, `is_exceptional = false` ← évite double-count
    avec `sum(contributions)` virtuel du group RAV, `created_by_profile_id =
    NEW.profile_id` ← avatar = la personne concernée).
  - `credit_balance_on_contribution_income_delete` (BEFORE DELETE on
    `real_income_entries`) — symétrique mais signe inversé : pour les
    expenses Sprint 16 V3 le BEFORE DELETE CRÉDITE le solde (restitution
    de débit), pour les incomes il DÉBITE (restitution de crédit).
  - Auto-devalidate : si `applied_to_balance_at != NULL` ET
    `last_applied_amount != NEW.contribution_amount`, débite le solde
    groupe de `last_applied_amount` + nullify `applied_to_balance_at` +
    **préserve `last_applied_amount`** pour le delta du warning UI.
- Migration `20260605000006_backfill_contribution_income_mirrors.sql` —
  INSERT en masse pour les `group_contributions` existants. Run-once
  idempotent.

**RPC orchestratrice atomique** :

- Migration `20260605000005_create_toggle_contribution_pair_applied_rpc.sql`
  — RPC `toggle_contribution_pair_applied(p_contribution_id, p_apply)` qui
  toggle la paire (expense user + income groupe) atomique en 1 tx :
  - SELECT FOR UPDATE des 2 rows par `contribution_id`.
  - Pour CHAQUE côté indépendamment, applique la logique drift-aware
    Sprint 16 V3 (apply standard / drift re-apply / un-apply / skip si
    déjà en sync).
  - Sémantique signe : EXPENSE apply DÉBITE bank_balance(profile),
    INCOME apply CRÉDITE bank_balance(group). À l'un-apply, restitution
    via `last_applied_amount`.
  - Au moins 1 des 2 côtés DOIT avoir changé pour considérer le toggle
    comme une action (sinon RAISE P0002 → 409 no-op UI).
  - Évite la récursion entre les 2 single-side RPCs existantes
    (`toggle_real_{expense,income}_applied_to_balance`) via une RPC
    orchestratrice unique = single source of truth.

**Routing handlers** :

- `lib/finance/applied-balance.ts` étendu avec helper
  `toggleContributionPairApplied(contributionId, apply)`.
- `lib/api/finance/expenses-toggle-applied.ts` + `income-toggle-applied.ts`
  — SELECT pre-check : si `contribution_id != null`, lit
  `group_contributions(profile_id, group_id)`, ensure les 2 bank_balances
  rows (profile + group), appelle l'orchestratrice. La réponse renvoie un
  shape compat avec les consumers existants (`balance` du côté pertinent
  selon la perspective de l'appel + champ `pair` pour debug).

**UI** :

- `components/dashboard/TransactionListItem.tsx` — `isContributionRow`
  étendu pour couvrir aussi le côté income (la détection check
  `type === 'income' && contribution_id != null`). Même catégorie grise
  ("Contribution groupe"), même warning UI, même kebab masqué. L'avatar
  vient nativement de `created_by_profile_id` via JOIN PostgREST
  (`real_income_entries_created_by_profile_id_fkey`) — pattern Sprint
  Group-Transaction-Creator-Avatar inchangé.
- Warning UI : le message FR `'vous devez ajouter X€ au groupe avant de
  valider cette dépense'` est ajusté avec `type === 'expense' ? 'cette
  dépense' : 'ce revenu'` pour le côté income.

**Guards 409** :

- `lib/api/finance/income-real.ts` PUT/DELETE — guards
  `cannot-edit-contribution-row` / `cannot-delete-contribution-row`
  symétriques au sprint 16 V3 expense.

## Cross-cutting

- `lib/query-client.ts` — `'real-incomes'` ajouté à
  `invalidateFinancialRefreshes` (la liste passe à 10 keys). Toute mutation
  budget groupe cascade trigger → recalc contributions → trigger
  sync_contribution_real_income met à jour le revenu miroir → l'UI doit
  refetch via TanStack invalidation.
- `scripts/check-rpcs.mjs` — `EXPECTED_RPCS` bumpé de 25 → 28 (les 3
  nouvelles RPCs).
- `lib/database.types.ts` — régénéré post-migrations (colonnes nouvelles +
  signature RPCs).

## Décisions produit clés

1. **Avatar des contributions miroir côté groupe = la personne concernée**
   (`group_contributions.profile_id`), pas le finaliseur du recap. Validé
   par le user en Q1 du planning : « Gilles voit son avatar sur "Contribution
   de Gilles", Marie voit le sien. »
2. **Read-only à vie côté income aussi** (Q2) — symétrique au sprint 16 V3
   expense. Le user a explicitement validé que les contributions miroir
   sont read-only comme le salaire.
3. **Pas de modal pour les contributions** (Q3 redirigé) — le mécanisme
   miroir Sprint 16 V3 étendu fait que les 2 sides sont parfaitement
   synchronisés (validation atomique, auto-devalidate identique). Pas
   besoin de modal séparée pour les contributions, l'UX est déjà uniforme
   avec les dépenses contribution existantes.
4. **Skip si salaire = 0** (Q4) — décision user explicite : pas de ligne
   créée pour étudiant/chômeur/congé sans solde.
5. **`is_exceptional = false` côté miroir income** — évite double-count
   avec `sum(contributions)` virtuel qui aggrège déjà côté group RAV. Le
   miroir impacte UNIQUEMENT bank_balance, conforme spec « impact
   uniquement sur le solde ».

## Vérification

- `pnpm typecheck` exit 0.
- `pnpm lint:check` 0/0.
- `pnpm build` route `/api/finance/income/real/validate-salary` registered
  (45 routes total).
- `pnpm test:run` 797 passants (les 6 failures sont préexistants sur
  AddProjectDialog/EditProjectDialog, non liés).
- `pnpm db:check-rpcs` exit 0 sur dev (28 RPCs présents).

## Migrations DB déployées (dev)

```
20260605000000_add_recap_origin_to_real_income_entries.sql
20260605000001_create_salary_income_for_recap_rpc.sql
20260605000002_create_validate_salary_with_delta_rpc.sql
20260605000003_add_contribution_id_to_real_income_entries.sql
20260605000004_create_contribution_real_income_triggers.sql
20260605000005_create_toggle_contribution_pair_applied_rpc.sql
20260605000006_backfill_contribution_income_mirrors.sql
```

À pousser vers prod après vérification UX sur dev (cf. CLAUDE.md §7 push
gate). `pnpm db:types` à régénérer depuis prod post-push pour réaligner
`lib/database.types.ts`.
