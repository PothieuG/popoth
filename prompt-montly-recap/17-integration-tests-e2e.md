# [17] — Tests intégration gated + E2E : 20+ cas couvrant tous les parcours

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3 — derniers tests pour couvrir l'ensemble du flow end-to-end + edge cases.
- Position dans la séquence : étape 17/17 (dernière)
- Dépend de : 01-16 (toutes les sous-tâches précédentes)
- Débloque : merge en main, baseline tests V3 actée

## Objectif
Écrire ≥20 cas de tests d'intégration gated `SUPABASE_RECAP_TESTS=1` qui couvrent l'ensemble des parcours du recap (positif léger, positif large, déficit piggy-only, déficit cascade, déficit cascade extrême, group multi-membre, resume mid-flow, transactions mixed, edge cases). Si Playwright disponible (à vérifier), ajouter quelques cas E2E browser sur le flow happy. Sinon, tests intégration via mocked-fetch et tests RTL avec MSW déjà couvrent l'essentiel.

## Fichiers concernés
- `lib/recap/__tests__/integration.test.ts` — à créer (gated, end-to-end flow tests via direct DB + endpoints)
- `components/monthly-recap/__tests__/full-flow.test.tsx` — à créer (RTL, full wizard flow with MSW)
- `app/api/monthly-recap/__tests__/full-flow.integration.test.ts` — à créer (gated, full sequence via fetch)
- Si Playwright installé : `e2e/monthly-recap.spec.ts` — à créer
- CLAUDE.md §9 Tests — MAJ counters tests gated/non-gated

## Patterns et conventions à respecter
- **Tests gated** : `SUPABASE_RECAP_TESTS=1`. `describe.skipIf(!process.env.SUPABASE_RECAP_TESTS)`. `await import(...)` dans beforeAll pour load lazy. Cleanup cascade dans afterAll (cf. CLAUDE.md §9).
- **Fixtures isolées** : créer un profile + group de test (UUIDs uniques) au beforeAll, cleanup au afterAll. Ne PAS polluer la prod.
- **Helpers réutilisables** : extraire `seedScenarioForTest(scenarioKey, profileId)` pour réutiliser les scenarios dev → fixtures.
- **Assertions cents-precise** : tous les montants validés à 0.01€ près (Math.round * 100).
- **MSW pour RTL** : intercepter les calls fetch vers `/api/monthly-recap/*` et retourner mock data conforme aux schémas.

## 20+ cas de tests cibles

### `lib/recap/__tests__/integration.test.ts` (gated, ~12 cas)

1. **Happy positive light** : seed budgets+expenses (3 surplus), start recap → status='in_progress' step='summary' → POST advance summary → manage_bilan → POST transform-remaining-surpluses-to-savings → cumulated_savings of 3 budgets +=surplus → step='salary_update' → POST update-salaries (no change) → step='final_recap' → POST complete → completed_at set, transactions non-validées flagged.

2. **Happy positive partial transfer** : seed similar, click "Oui" + drawer, transfer 2/3 surplus to piggy → piggy.amount += sum(2 surplus), 1 budget surplus restant → transform-remaining-surpluses-to-savings → 1 budget gets cumulated_savings += surplus → complete.

3. **Deficit piggy fully covers** : seed deficit=50, piggy=100 → start → status manage_bilan, bilan='negative' → POST refloat-from-piggy amount=50 → piggy=50, refloated=50, deficit=0 → UI bascule sur flow positif (le test simule la transition vers transform-remaining) → complete.

4. **Deficit piggy partial + savings full** : seed deficit=200, piggy=50, savings cumul=150 → refloat piggy 50 → deficit=150 → refloat-savings → savings cascadé proportional → deficit=0 → complete.

5. **Deficit cascade full (3 lines)** : deficit=500, piggy=100, savings=100 → refloat piggy 100 + refloat savings 100 + save-snapshot 300 split over budgets → deficit=0 → complete → carryover_spent_amount des budgets += snapshot.

6. **Deficit piggy + savings insufficient + snapshot all** : piggy=0, savings=0, deficit=300 → snapshot 300 proportional split → complete → all carryover_spent_amount populated.

7. **Group lock simulation** : créer recap par profileA, puis tenter POST start par profileB du même group → 409 locked_by_other, recap not modified.

8. **Group salary update + contributions recalc** : seed group avec 2 members A,B salaires {3000, 2000}, run recap perso pas important → POST update-salaries du group avec {A:3500, B:2000} → calculate_group_contributions called → group_contributions row de A et B updated.

9. **Resume mid-flow** : seed recap with current_step='manage_bilan', refloated_from_piggy=50 → GET status → kind='in_progress' step='manage_bilan' summary.bilan correctly computed → continue flow.

10. **Idempotency complete** : run flow jusqu'à complete + POST complete (1er) → success completed_at set → POST complete (2eme) → 200 + alreadyCompleted=true (pas 410, idempotent friendly).

11. **Complete process transactions** : seed 5 real_expenses (3 applied, 2 non-applied) + 3 real_income_entries (2 applied, 1 non-applied) → run flow → complete → DB state : 3 expenses deleted, 2 carried_over=true + carried_from_recap_id=recap.id ; 2 incomes deleted, 1 carried_over=true.

12. **Complete apply snapshot** : seed budgets {b1: estimated=100, b2: estimated=200, carryover_spent_amount=0} → snapshot {b1:20, b2:40} → complete → b1.carryover_spent_amount=20, b2.carryover_spent_amount=40, carryover_applied_date set.

### `app/api/monthly-recap/__tests__/full-flow.integration.test.ts` (gated, ~6 cas)

Tests qui font HTTP calls réels vers les endpoints (via Next.js test client ou supertest si setup).

13. **Full positive flow via HTTP** : POST start → GET status (in_progress) → POST advance-step → POST transform → POST advance → POST update-salaries → POST complete → GET status (completed). Assertions sur chaque response.

14. **Full negative flow via HTTP** : ditto avec deficit + refloat-from-piggy + refloat-from-savings + save-budget-snapshot + advance + update-salaries + complete.

15. **Lock 409 via HTTP** : userA start, userB try start → 409 body.error='locked_by_other'.

16. **Permission errors 403** : userB du même group try update-salaries → 403 not_initiator.

17. **State transition violation 409** : try POST refloat-from-piggy while step='final_recap' → 409 invalid_step.

18. **Bad body 400** : POST update-salaries with salaries=[] → 400 Zod fail.

### `components/monthly-recap/__tests__/full-flow.test.tsx` (RTL with MSW, ~4 cas)

19. **Welcome → Summary → BilanPositive → Salary → Final → Dashboard** : mock all endpoints, render `<RecapWizard context="profile" />`, simulate click sequence, assert step transitions.

20. **GroupLockScreen renders for locked_by_other** : mock status returns kind='locked_by_other', render RecapWizard, assert lock screen visible + logout button.

21. **Resume at salary_update** : mock status returns step='salary_update' + summary, render → SalaryUpdateStep visible immediately.

22. **Complete idempotency UX** : mock complete returns alreadyCompleted=true, click complete → router.replace called.

### Optional Playwright E2E (`e2e/monthly-recap.spec.ts`)

Si Playwright disponible (vérifier `package.json` devDeps) :

23. **Headless happy path** : login → seed scenario `happy-surplus-light` via /dev/recap → /monthly-recap → click "Commencer" → click "Étape suivante" → "Non" → "Transformer tous" → "Non" salary → "Retourner au dashboard" → assert URL /dashboard.

24. **Headless deficit path** : seed `deficit-cascade-full` → flow complet jusqu'à complete → assert dashboard.

## Étapes d'implémentation suggérées
1. **Inventaire setup test existant** : vérifier `vitest.config.ts` pour les `test.projects`, MSW config, Playwright (s'il existe).
2. **Créer `lib/recap/__tests__/integration.test.ts`** : 12 cas avec fixtures partagés (profile/group/auth création au beforeAll). Cleanup cascade.
3. **Créer `app/api/monthly-recap/__tests__/full-flow.integration.test.ts`** : 6 cas HTTP. Utiliser `fetch` direct vers localhost ou Next.js test handler.
4. **Créer `components/monthly-recap/__tests__/full-flow.test.tsx`** : 4 cas RTL avec MSW intercept.
5. **Si Playwright installé** : 2 cas E2E.
6. **MAJ CLAUDE.md §9** : ajouter counter "Tests gated `SUPABASE_RECAP_TESTS=1` : 25+ cas (12 algo + 6 http + autres)".
7. **MAJ CLAUDE.md §5.5** : invariant "Tests gated recap" → 25+.
8. **Vérification** : tous les tests gated passent (`SUPABASE_RECAP_TESTS=1 pnpm test:run`). Tests non-gated passent.
9. **Documentation closeout** : éventuellement créer `.claude/history/roadmap-detailed-NN-monthly-recap-v3.md` avec un résumé des 17 sous-tâches livrées.
10. **Commit** : `test(recap): 25+ integration + E2E tests covering all flows`.

## Critères d'acceptation
- [ ] ≥20 cas de tests gated/RTL/E2E créés au total
- [ ] Couverture : positive, negative piggy-only, negative cascade full, group lock, group salary, resume, idempotency, permissions, state transitions, bad input
- [ ] `SUPABASE_RECAP_TESTS=1 pnpm test:run` exit 0 (tous gated tests passent)
- [ ] `pnpm test:run` sans env var exit 0 (tests non-gated + RTL passent)
- [ ] CLAUDE.md §9 mis à jour avec le nouveau count
- [ ] CLAUDE.md §5.5 invariants "Tests gated" mis à jour
- [ ] `pnpm verify` exit 0 (sanity sweep complet)
- [ ] Si Playwright installé : 2 cas E2E créés et passants
- [ ] Aucun test marqué `.skip` ou `.todo` dans les nouveaux fichiers (sauf legit raison documentée)

## Tests à écrire

(Cf. liste 20+ cas ci-dessus.)

## Pièges et points d'attention
- **Cleanup cascade obligatoire** : DELETE en cascade dans afterAll — monthly_recaps → real_expenses → real_income_entries → estimated_budgets → group_contributions → piggy_bank → bank_balances → profile. Sinon DB bloat + FK violations sur reruns.
- **Fixtures isolées par test** : UUIDs uniques par test (utiliser `crypto.randomUUID()` ou suffix timestamp). Pas de globals partagés entre tests pour éviter cross-pollution.
- **`await import()` dans beforeAll** : crucial pour les modules qui importent supabaseServer. Sinon Vitest essaie de load au module-time et fait foiret si env var absente.
- **Tests HTTP** : si pas de test server setup, utiliser `next/test` ou `node-mocks-http` pour invoquer les handlers directement. Ou setup un server in-process.
- **MSW pour RTL** : si MSW est déjà setup dans le repo, réutiliser. Sinon, mock fetch via `vi.spyOn(global, 'fetch')`. Cf. patterns existing dans `components/__tests__/`.
- **`chunked` helper** : pattern CLAUDE.md §9 pour batch 10× appels (pool undici). Utiliser pour les tests concurrence si présents.
- **Playwright optionnel** : ne PAS bloquer cette sous-tâche si Playwright absent. Skip les 2 cas E2E avec note "Playwright à ajouter futur sprint".
- **Idempotency test** : crucial pour valider que les retries réseau ne corrompent rien. Tester explicitement le 2eme call complete.
- **Race condition lock test** : pour tester la lock atomique groupe, lancer 2 POST start simultanés (Promise.all). Assert un seul succeed, l'autre 409.
- **Caractérisation byte-identique** : pour les flows complets, snapshot l'état DB final (recap row + transactions count) et asserter byte-identique. Crucial si on refacto un endpoint plus tard.

## Commandes utiles
```bash
# Tests gated complets
SUPABASE_RECAP_TESTS=1 pnpm test:run lib/recap/__tests__/integration.test.ts app/api/monthly-recap/__tests__/full-flow.integration.test.ts

# Tests RTL non-gated
pnpm test:run components/monthly-recap/__tests__/full-flow.test.tsx

# Playwright si installé
pnpm playwright test e2e/monthly-recap.spec.ts

# Sanity complet
pnpm verify
```

## Definition of Done
- Tous les critères d'acceptation cochés
- ≥20 cas de tests créés et passants
- CLAUDE.md à jour (§5.5 invariants + §9 tests)
- `pnpm verify` exit 0
- Commit `test(recap): 25+ integration + E2E tests covering all flows`
- Optionnel : commit séparé `docs(recap): roadmap closeout entry for V3 implementation`
- **Feature complète** : le Monthly Recap V3 est prêt pour merge en main
