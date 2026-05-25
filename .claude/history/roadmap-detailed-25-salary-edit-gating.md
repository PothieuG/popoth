# Roadmap détaillée — Part 25 : Salary-Edit-Gating

> Append-only chronologique. Voir [CLAUDE.md §11](../../CLAUDE.md) pour l'index global. Part précédente : [Part 24](roadmap-detailed-24-contribution.md) (Sprint 16 V3 + Contribution dépense virtuelle).

---

- ✅ **Sprint Salary-Edit-Gating — Salaire éditable uniquement si planificateur vierge ou via wizard recap** (livré 2026-05-25, 1 commit). Règle produit demandée par user : 2 voies seulement pour modifier son salaire.
  1. **À la fin du recap mensuel** — déjà géré par le wizard (sprint 08 V3, étape `salary_update`, endpoint `POST /api/monthly-recap/update-salaries`). Pas de changement sur ce path.
  2. **Quand le planificateur est vierge** — aucune ligne dans `estimated_budgets`, `estimated_incomes`, `real_expenses`, `real_income_entries` (toutes les rows comptent, y compris les carry-overs).

  **Motivation** : avant le sprint, un user pouvait éditer son salaire à n'importe quel moment dans Settings → `PUT /api/profile`. Le trigger `trigger_recalculate_contributions` re-calculait alors les contributions du groupe sans que les co-équipiers soient prévenus, et faussait les calculs RAV du mois en cours. La nouvelle règle aligne Settings sur l'unique autre voie autorisée (le wizard recap), et garantit que toute modification de salaire arrive soit en fin de cycle mensuel, soit quand l'app est complètement vierge (pas d'impact sur des calculs en cours).

  **Scope "vierge" décidé avec le user** (option "Variable selon contexte") :
  - **Solo** (`profile.group_id = null`) : on regarde uniquement les 4 tables filtrées `profile_id = userId`.
  - **En groupe** (`profile.group_id` non-null) : on regarde **ses rows perso (`profile_id = userId`)** ET **les rows du groupe (`group_id = profile.group_id`)** — les deux scopes doivent être vides ensemble. Évite que le co-équipier voie sa contribution recalculée sans l'avoir déclenché.

  **Carry-overs comptent** (décision user "Non, une reportée = pas vierge") : tant qu'il y a une ligne dans le dashboard (même avec badge "Mois précédent"), le planificateur n'est pas vierge. Pas de filtre `is_carried_over` dans les SELECT counts.

  **Architecture installée** :

  **(1) Helper [lib/finance/planner-emptiness.ts](../../lib/finance/planner-emptiness.ts)** : nouveau module exportant `isPlannerEmpty(scope)` + `canEditSalary(profile)`.
  - `PlannerScope = { type: 'profile', profileId } | { type: 'group', profileId, groupId }`.
  - `isPlannerEmpty` lance 4 SELECT COUNT en parallèle via `Promise.all` sur les 4 tables planificateur. Pour `type='profile'` : `.eq('profile_id', X)`. Pour `type='group'` : `.or('profile_id.eq.X,group_id.eq.Y')` — single round-trip par table.
  - Retourne `true` ssi tous les counts === 0.
  - `canEditSalary(profile)` construit le scope selon `profile.group_id` puis appelle `isPlannerEmpty`. Retourne `{ editable: boolean, reason: 'planner-not-empty' | null }`.
  - Pattern Supabase : `.select('id', { count: 'exact', head: true })` — minimise le payload (HEAD-only, pas de body).

  **(2) Endpoint GET [app/api/profile/salary-editability/route.ts](../../app/api/profile/salary-editability/route.ts)** : wrapper `withAuthAndProfile`, appelle `canEditSalary(profile)`, retourne `{ data: { editable, reason } }`. Format réponse standard `{ data: T } | { error: string }`.

  **(3) Server-side enforcement [app/api/profile/route.ts](../../app/api/profile/route.ts) PUT** : si `body.salary !== undefined` ET diffère de `existing.salary` ET `canEditSalary` retourne `editable=false` → 409 `cannot-edit-salary-when-planner-not-empty`. Le check est conditionnel à la présence ET au changement effectif du champ — les autres champs (`first_name`, `last_name`, `avatar_url`) passent toujours. Le PUT existant ne fetchait pas le profile au préalable ; ajout d'un SELECT `id, group_id, salary` ciblé en amont.

  **(4) Hook [hooks/useSalaryEditability.ts](../../hooks/useSalaryEditability.ts)** : `useQuery({ queryKey: ['salary-editability'], queryFn })`. Retourne `{ editable, reason, isLoading, isFetching, error }`. Pattern miroir `useProfile` (TanStack Query + AbortSignal).

  **(5) Invalidation cross-domain [lib/query-client.ts](../../lib/query-client.ts)** : ajout `['salary-editability']` à `invalidateFinancialRefreshes` (8 keys totales, +1 vs sprint 16 Contribution). Toute mutation budget/income/expense propagée existante refetch désormais la décision serveur, sans plumbing dans les hooks consommateurs. Test `lib/__tests__/query-client.test.ts` mis à jour (7 → 8 invalidations ordonnées).

  **(6) UI [components/profile/ProfileSettingsCard.tsx](../../components/profile/ProfileSettingsCard.tsx)** :
  - Consommation `useSalaryEditability()` dans le composant interne ; `salaryLocked = !editable`.
  - Input salary `disabled={salaryLocked}` + `aria-describedby="salary-locked-hint"` quand locked + classe `bg-gray-50 text-gray-500 cursor-not-allowed`.
  - Helper conditionnel sous l'input : si `salaryLocked && !salaryEditabilityLoading` → ligne avec icône Lucide `Lock` + texte "Modifiable à la fin de ton recap mensuel, ou quand ton planificateur est complètement vide." Sinon (éditable OU loading) → helper existant "Requis pour la contribution au groupe".
  - `validateForm` : skip la validation salary quand `salaryLocked` (le champ étant read-only, le user ne peut pas le saturer/vider — on ne génère pas d'erreur inappropriée).
  - `handleSave` : omet `salary` du payload PUT quand `salaryLocked` (defense-in-depth — le server enforce le 409, mais omettre le champ préserve la sémantique partielle du PUT et évite le 409 inutile sur un user qui modifierait juste son prénom).
  - Bouton Enregistrer disabled si `isSaving || salaryEditabilityLoading || (!salaryLocked && contributionWarning) || errors`. Le `salaryEditabilityLoading` ajoute un filet anti-soumission pendant le fetch initial.
  - `contributionWarning` (warning groupe quand salaire trop élevé) caché quand `salaryLocked` — sinon faux-positif sur input figé.
  - Le bouton Modifier reste visible et fonctionnel ; le reste du formulaire (prénom, nom, avatar) reste éditable même quand salary locked.

  **(7) Le wizard recap (`POST /api/monthly-recap/update-salaries`, sprint 08 V3) n'est PAS gated par cet endpoint** — c'est l'autre voie autorisée, dédiée et indépendante. Aucune modification de ce path. Quand l'user finalise un recap via le wizard, son salaire est appliqué directement, indépendamment de l'état du planificateur post-recap (qui contient typiquement les carry-overs + budgets reportés).

  **(8) Pattern réutilisable installé** : "feature-gating server-driven via GET helper + cross-domain invalidation TanStack". Applicable à toute future condition produit qui dépend de l'état de plusieurs tables et doit se relâcher/resserrer dynamiquement côté UI sans refresh.

  **Tests** :
  - **Gated SUPABASE_FINANCE_TESTS (11 cas, [lib/finance/\_\_tests\_\_/planner-emptiness.test.ts](../../lib/finance/__tests__/planner-emptiness.test.ts))** : 5 cas solo (vierge, +1 estimated_budget, +1 estimated_income, +1 real_expense, +1 real_income_entry) + 5 cas group (perso+groupe vides, perso peuplé, groupe peuplé, group_id match autre user, solo unrelated ignoré) + 3 cas `canEditSalary` (scope-routing solo vs group + isolation).
  - **RTL non-gated (5 cas, [components/profile/\_\_tests\_\_/ProfileSettingsCard.test.tsx](../../components/profile/__tests__/ProfileSettingsCard.test.tsx))** : disabled+helper quand locked, enabled+pas-de-helper quand vierge, disabled pendant loading sans flicker du helper, payload omet salary si locked, payload inclut salary si éditable.
  - **Query-client (1 cas, [lib/\_\_tests\_\_/query-client.test.ts](../../lib/__tests__/query-client.test.ts))** : count d'invalidations 7 → 8 + ordre vérifié.
  - **Suite complète** : 626 → 631 non-gated (+5 RTL) ; 187 → 198 gated (+11 planner-emptiness).

  **Pipeline verify** : `pnpm typecheck` OK, `pnpm lint:check` 0/0, `pnpm format:check` OK, `pnpm test:run` 631 passants. `db:check-drift` / `db:check-rpcs` / `db:check-types-fresh` échouent — drift préexistant sur la branche `monthly_recap`, indépendant de ce sprint (aucune modification du schéma SQL).

---

**Synthèse Part 25** : 1 sprint livré, 1 commit, 0 migration DB (logique 100% côté TypeScript/Supabase JS — pas de RPC ni de trigger). Tests **626 → 631 non-gated** + **187 → 198 gated**. Routes API 40 → 41 (1 nouveau endpoint GET `/api/profile/salary-editability`). 0 RPC ajoutée. 8 queryKeys invalidées cross-domain (vs 7 avant).
