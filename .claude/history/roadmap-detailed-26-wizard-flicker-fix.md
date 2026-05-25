# Roadmap détaillée — Part 26 : Recap-Wizard-Flicker-Fix

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

---

**Synthèse Part 26** : 1 sprint fix UX + 1 outil QA. **8 fichiers app/components/hooks touchés** + **3 tests adaptés + 2 nouveaux**. **0 migration DB / 0 changement contrat API / 0 nouvelle RPC**. Tests **658 → 660 non-gated** (+2 generic-error guards). Pattern "await invalidate critique + void background" pinné dans operational-rules. Bonus : 28e scénario seed `random-profile.mjs` pour QA bout-en-bout.
