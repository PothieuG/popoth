# Roadmap détaillée — Part 26 : Recap-Wizard-Flicker-Fix + Fix-Recap-Welcome-Skip

> Append-only chronologique. Voir [CLAUDE.md §11](../../CLAUDE.md) pour l'index global. Part précédente : [Part 25](roadmap-detailed-25-salary-edit-gating.md) (Salary-Edit-Gating).

---

- ✅ **Sprint Recap-Wizard-Flicker-Fix — Boutons d'action persistent disabled + swallow erreurs idempotentes** (livré 2026-05-30, 2 commits). Deux bugs UX rapportés sur le wizard Monthly Recap V3 — même cause-racine technique (fenêtre temporelle entre `mutation.isPending → false` et le re-routing du wizard après refetch du status), manifestations différentes côté utilisateur.

  **Bug 1 — Boutons d'action se ré-activent brièvement pendant le chargement** : à chaque étape (Commencer / Continuer / Mettre à jour / Finaliser), après un clic, le bouton passe correctement en "Chargement…" disabled mais existait une fenêtre de ~100-500 ms où il redevenait cliquable AVANT que le wizard ne route vers l'étape suivante. User impatient = double-clic = mutation fired 2×.

  **Bug 2 — Message d'erreur flickerant** : sur WelcomeStep et autres écrans, le catch affichait brièvement le message d'erreur sur les codes `stale_step` / `invalid_step` (cas d'idempotence — double-clic, refresh mid-flow, multi-tab). Le hook ré-invalidait ensuite le cache → le wizard route vers l'étape suivante → l'erreur disparaît avant que le user puisse la lire.

  **Cause racine commune** : dans [hooks/useMonthlyRecap.ts](../../hooks/useMonthlyRecap.ts), 5 hooks utilisaient `void qc.invalidateQueries(recapStatusKey(context))` dans leur `onSuccess` (et `onError` pour `useAdvanceStep`). Le `void` retourne immédiatement, `mutation.isPending` passe à `false`, et le composant re-render avec `disabled = false` AVANT que le refetch du `/status` ne complète. Les 4 autres hooks qui utilisent `setQueryData` synchrone n'ont pas le problème (cache à jour avant que `mutateAsync` ne résolve).

  Pour le bug 2, l'origine de l'erreur est le serveur qui répond `stale_step` / `invalid_step` — sémantiquement des "succès idempotents" ("tu es déjà au bon endroit"). 2 step screens swallow déjà ces codes (`BilanNegativeStep` les 2, `CompleteMonthStep` `stale_step` seul) mais 5 autres ne le faisaient pas.

  **Architecture installée** :

  **(1) `await` l'invalidation critique du recapStatusKey** ([hooks/useMonthlyRecap.ts](../../hooks/useMonthlyRecap.ts)). 5 hooks convertis :
  - `useStartRecap.onSuccess` → `async` + `await invalidateQueries`
  - `useAdvanceStep.onSuccess` + `.onError` (branche `stale_step` / `invalid_step`) → `async` + `await`
  - `useTransformRemainingSurplusesToSavings.onSuccess` → idem
  - `useUpdateSalaries.onSuccess` → `await` sur status uniquement + `void` sur `['profile']` + `invalidateFinancialRefreshes` (non-bloquant pour le routing wizard, refetch en arrière-plan)
  - `useCompleteRecap.onSuccess` → `await` sur status + `void` sur `invalidateFinancialRefreshes`

  Conséquence : `mutation.isPending` reste `true` pendant que le refetch tourne (~200-800 ms selon réseau). Quand il termine, le `useQuery` re-render avec le nouveau `status.step`, le `RecapWizard` swap le composant step, l'ancien bouton est unmount sans jamais redevenir cliquable.

  Hooks intacts (`setQueryData` synchrone, pas de fenêtre flicker) : `useTransferSurplusesToPiggy`, `useRefloatFromPiggy`, `useRefloatFromSavings`, `useSaveBudgetSnapshot`.

  **(2) Swallow `stale_step` + `invalid_step` dans tous les catch step screens**. Pattern miroir installé dans `BilanNegativeStep.tsx:155-160` (sprint 13 V3) appliqué partout :

  ```ts
  } catch (e) {
    const code = e instanceof Error ? e.message : 'unknown'
    if (code === 'stale_step' || code === 'invalid_step') return
    setError(pickErrorCopy(code))
    // ... reste catch (e.g. already_completed redirect dans WelcomeStep)
  }
  ```

  6 fichiers patchés : `WelcomeStep` (`handleStart`), `BilanPositiveStep` (`handleContinue`), `SummaryStep` (`handleNext`), `SalaryUpdateStep` (`handleSkip` + `handleSubmitSalaries`, 2 catch), `FinalRecapStep` (`handleComplete`), `CompleteMonthStep` (`handleNext`) — étendu pour swallow aussi `invalid_step` (cohérence pattern miroir, avant : `stale_step` seul).

  Composant déjà conforme : `BilanNegativeStep` — swallow déjà les 2 codes, et ses 3 mutations descendantes utilisent `setQueryData` synchrone.

  **Combinaison Bug 1 + Bug 2** : avec l'`await` sur l'invalidation, le `return` du swallow se fait APRÈS que le refetch ait routé le wizard → l'ancien step component est déjà en cours d'unmount quand le catch fire, donc même le `setError` n'aurait rien rendu visible. On garde quand même le `return` explicite pour clarté + résilience aux changements futurs (si un jour un hook redevient `void`, le swallow tient encore).

  **Tests** :
  - 3 regression-guards adaptés au nouveau contrat (`BilanPositiveStep.test.tsx`, `FinalRecapStep.test.tsx`, `SummaryStep.test.tsx`) — assertent désormais `screen.queryByRole('alert')).not.toBeInTheDocument()` après mutation rejected avec `stale_step` / `invalid_step`.
  - 2 nouveaux tests "generic error stays visible" sur FinalRecapStep + SummaryStep (`mockRejectedValueOnce(new Error('boom'))` doit toujours afficher `role="alert"` avec le copy générique). Couvre la non-régression du contrat "erreurs LÉGITIMES restent visibles".
  - Total : 658 → 660 non-gated (+2 ajoutés ; les 3 adaptés ne changent pas le count).

  **Pipeline verify** : `pnpm typecheck` OK, `pnpm lint:check` 0/0, `pnpm format:check` OK, `pnpm test:run` 660 passants + 200 skipped. `db:check-drift` échoue — drift préexistant sur la branche `monthly_recap`, indépendant de ce sprint (aucune modification du schéma SQL).

  **Patterns réutilisables installés** (cf. [.claude/conventions/operational-rules.md](../conventions/operational-rules.md) §5 "Recap wizard mutations") :
  - "await invalidate pour le critique routing-driver + void pour les invalidations background"
  - "swallow uniforme `stale_step` / `invalid_step` en début de catch des step screens"

- ✅ **Bonus — seed script `random-profile` pour QA wizard** ([scripts/seed-recap/random-profile.mjs](../../scripts/seed-recap/random-profile.mjs), 1 commit). Outil QA pour faciliter le test bout-en-bout du wizard sans avoir à choisir un scénario figé. Re-run = re-cleanup + re-seed avec un nouveau random à chaque exécution.

  Génère pour USER_A (`gilles.pothieu@gmail.com`) : 1 salaire 1500-4500€, 1 tirelire 0-500€, 1 bank 500-3500€, 3-6 budgets random piochés dans un pool de 10 catégories réalistes (Courses, Loisirs, Transport, etc.), 1-3 dépenses par budget (facteur 0.4-1.3 × estimated → mix surplus/déficit), 50 % des budgets avec économies préexistantes 10-50€ (active la cascade savings du bilan négatif), 0-2 revenus exceptionnels optionnels (30 % de chance).

  État résultant : `status='no_recap'` → wizard ouvre sur l'écran "Bienvenue". Permet de traverser la cascade complète (Commencer → Compléter le mois → Récap général → Bilan ± → Salaire → Final) avec des chiffres différents à chaque test, idéal pour vérifier le fix anti-flicker dans des conditions variées.

  Mécanisme idempotent : `cleanupCurrentMonth({ profile: true, group: false })` wipe le state du mois courant pour USER_A uniquement (le groupe n'est pas touché, contrairement à `_reset.mjs`).

- ✅ **Sprint Fix-Recap-Welcome-Skip — Étape « Compléter le mois » sautée après l'écran de bienvenue** (livré 2026-05-31, 1 commit). Bug UX rapporté par le user sur la branche `monthly_recap` : depuis l'écran Welcome du wizard Monthly Recap V3, le clic « Commencer » envoyait l'utilisateur directement à l'écran Summary, court-circuitant l'étape « Compléter le mois » introduite au commit `0f7323a feat(recap): add "Compléter le mois" step before bilan` (Sprint Complete-Month-Step, 2026-05-29). L'étape — où l'utilisateur peut ajouter des dépenses/revenus oubliés du mois recapé avant le bilan — n'était jamais visible.

  **Cause racine** : la RPC PG `start_monthly_recap` ([supabase/migrations/20260525000000_create_recap_start_rpc.sql](../../supabase/migrations/20260525000000_create_recap_start_rpc.sql) ligne 72) hardcode `current_step = 'summary'` au moment de l'INSERT initial dans `monthly_recaps`. Cascade :
  1. `POST /api/monthly-recap/start` → RPC crée la ligne avec `current_step = 'summary'`.
  2. `WelcomeStep` enchaîne `POST /api/monthly-recap/advance-step { fromStep: 'welcome', toStep: 'complete_month' }`.
  3. L'endpoint advance-step lit la ligne DB → `current_step` est `'summary'`, pas `'welcome'` → `executeAdvanceStep` retourne `stale_step` → HTTP **409**.
  4. `WelcomeStep` ligne 45 avale silencieusement `stale_step` (volontaire, Sprint Recap-Wizard-Flicker-Fix ci-dessus — garde-fou contre les double-clicks).
  5. Le wizard re-fetch le status → trouve `'summary'` → route directement vers `SummaryStep`. `CompleteMonthStep` jamais affiché.

  **Pourquoi le bug a passé** : à la création de la RPC (Sprint 05 V3, 2026-05-25), `'welcome'` était une carte client-only et le premier step server-persisted était `'summary'`. Le sprint Complete-Month-Step (2026-05-29) a inséré `'welcome'` puis `'complete_month'` comme premiers steps server-persisted en étendant l'enum `RECAP_STEP_ORDER` ([lib/recap/state.ts](../../lib/recap/state.ts)) et la CHECK constraint ([migration 20260529](../../supabase/migrations/20260529000000_extend_recap_step_complete_month.sql)), mais **sans rebaser la ligne 72 de la RPC start**. Le test d'intégration [`app/api/monthly-recap/start/__tests__/route.integration.test.ts:173`](../../app/api/monthly-recap/start/__tests__/route.integration.test.ts) ratifiait le mauvais comportement (`expect(body.data.recap.current_step).toBe('summary')`) — écrit avant le sprint Complete-Month-Step et non mis à jour à l'époque. Le swallow `stale_step` du sprint Flicker-Fix masquait l'erreur 409 qui aurait alerté.

  **Fix** :
  - Migration RPC ligne 72 : `'summary'` → `'welcome'`. Fix **in-place** (pas de nouvelle migration `CREATE OR REPLACE`) car la branche `monthly_recap` est encore feature, non shippée prod (cf. commit `0f7323a` « applied to dev; pending prod push as part of the V3 batch »). La migration commence par `DROP FUNCTION IF EXISTS ... CREATE OR REPLACE` (ligne 35-37) → ré-application idempotente via `node scripts/apply-sql.mjs supabase/migrations/20260525000000_create_recap_start_rpc.sql`.
  - Test intégration ligne 173 : `'summary'` → `'welcome'`. Les autres usages de `'summary'` dans le fichier (lignes 198, 263) sont des fixtures pre-existing pour simuler un wizard déjà en cours sur les cas `resumed` / `locked_by_other` — non touchés.

  **Files non-modifiés (vérifiés sains)** :
  - [lib/recap/state.ts](../../lib/recap/state.ts) — `RECAP_STEP_ORDER` ordre correct `['welcome', 'complete_month', 'summary', ...]`.
  - [components/monthly-recap/steps/WelcomeStep.tsx](../../components/monthly-recap/steps/WelcomeStep.tsx) ligne 42 — transition `welcome → complete_month` correcte ; swallow ligne 45 conservé (garde-fou idempotence Flicker-Fix).
  - [app/api/monthly-recap/advance-step/route.ts](../../app/api/monthly-recap/advance-step/route.ts) — logique OK, retourne `409 stale_step` quand mismatch (c'est ce qui révélait le bug avant le swallow).

  **Pipeline verify** : `pnpm typecheck` OK, `pnpm test:run` 658 non-gated passants 0 failed (count stable, edit in-place), tests gated `SUPABASE_RECAP_TESTS=1` sur `start + lib/recap` 112/113 passants (1 brittle pré-existant `check-status.test.ts:166` ISO format JS `'40.640Z'` vs PG `'40.64+00:00'` — confirmé indépendant via stash sur HEAD). `db:audit-functions` 28/28 ; `db:check-rpcs` 19/19 (`start_monthly_recap` listée ligne 13 du output) ; `db:check-functions` 5/5 ; `db:check-types-fresh` OK. `db:check-drift` fail pré-existant sur sprint 16 (`real_expenses.contribution_id` + `last_applied_amount` + 5 triggers jamais réexportés dans `20260101000000_remote_schema.sql`) — hors scope.

  **Règle ❌ pinnée** (pour future référence — non-ajoutée dans operational-rules.md faute de marge 39.5k disponible) : **NE PAS hardcoder un step non-initial (`'summary'`, `'manage_bilan'`, etc.) comme literal `current_step` dans l'INSERT de `start_monthly_recap`**. Le wizard part toujours de `'welcome'` et avance explicitement via `POST /api/monthly-recap/advance-step`. Tout autre literal crée un mismatch DB ↔ client qui est silencieusement avalé par le swallow `stale_step` du WelcomeStep → l'étape (`'complete_month'` ou future) est sautée. Si jamais on doit changer le step initial, la nouvelle valeur DOIT être le premier élément de `RECAP_STEP_ORDER` (actuellement `'welcome'`).

  **Risque résiduel** : si la migration 20260525 a été push en prod entre-temps, basculer vers une nouvelle migration `CREATE OR REPLACE FUNCTION start_monthly_recap` au moment du push prod du sprint V3 (pattern « never modify an applied prod migration »). À vérifier avec user avant push prod.

---

**Synthèse Part 26** : 2 sprints fix UX/DB + 1 outil QA. **Recap-Wizard-Flicker-Fix** : 8 fichiers app/components/hooks touchés + 3 tests adaptés + 2 nouveaux (658 → 660 non-gated, +2 generic-error guards) ; pattern "await invalidate critique + void background" pinné dans operational-rules. **Fix-Recap-Welcome-Skip** : 1 migration SQL + 1 test intégration (1 ligne chaque) ; 0 changement contrat API / 0 nouvelle RPC. Bonus : 28e scénario seed `random-profile.mjs` pour QA bout-en-bout.
