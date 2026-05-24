# Roadmap détaillé — Part 22 : Screens 13-14 V3

> Chronologie des sprints 13 et 14/17 Monthly Recap V3 (livrés 2026-05-24 et 2026-05-25). Split forcé : la Part 21 dépassait le cap 39.5k après ajout du verbatim sprint 13 (~19.5k chars). Sprint 14 ajouté à cette part par capacité résiduelle.

## Sprints

- ✅ **Sprint Screen-Bilan-Negative-V3** (sprint 13/17 Monthly Recap V3, livré 2026-05-24). Remplit le placeholder `BilanNegativeStep` (écran 3B, cas `bilanSign === 'negative'`). Cascade séquentielle 3 lignes (tirelire → économies des budgets → équilibrage proportionnel snapshot) avec gating strict (une seule ligne active à la fois) et **pas de page change** post-mutation. 13 fichiers core (4 composants UI + 1 pure module + 1 hook étendu + 1 status route étendue + 1 types + 1 load-summary + 1 calculations + 1 wizard) + 8 tests + 4 scripts dev + 1 helper script + 4 mises à jour prompts. **Tests 529 → 566 non-gated**. Routes API inchangées (les 3 endpoints refloat étaient livrés sprint 07). 6 commits incrémentaux dont 1 bug-fix critique (barrel leak) + 5 itérations UX successives basées sur retours user.

  **Architecture installée** :

  **(1) `BilanNegativeStep.tsx` (~190 LOC)** : orchestrateur. Compute `deficitRemaining` live à chaque render via `computeDeficitRemaining({ initialBilan: summary.bilan, refloatedFromPiggy, refloatedFromSavings, snapshotData })` (helper pur). State machine 3 lignes calculé en cascade :
  - **piggyState** : `done` si `refloatedFromPiggy > 0` ; `empty` si `piggyAmount ≤ 0.01` ; `unneeded` si déficit comblé en amont (rare) ; `active` sinon.
  - **savingsState** : `done` si `refloatedFromSavings > 0` ; `empty` si `totalSavings ≤ 0.01` ; `unneeded` si `deficitCovered` ; `locked` si la tirelire n'est pas out-of-the-way (`piggyDone || piggyEmpty`) ; `active` sinon.
  - **snapshotState** : `done` si `sum(snapshotData) > 0` ; `unneeded` si `deficitCovered` ; `locked` si savings pas out-of-the-way ; `active` sinon.

  Ordre critique : **`deficitCovered` (unneeded) PRÉCÈDE `locked`** dans la cascade — un déficit comblé en amont neutralise les lignes suivantes plutôt que de les "attendre" pour rien. Snackbar succès centralisée via callback `onSuccess` passé à chaque ligne, `setTimeout(setSuccessMessage(null), 3000)` auto-dismiss. ERROR_COPY dict mappe 7 codes serveur (`invalid_step`, `not_initiator`, `no_active_recap`, `no_deficit`, `overflow`, `piggy_insufficient`, `stale_step`). Bouton "Continuer" en bas quand `showContinuer = deficitCovered`, swallow gracieusement `invalid_step`/`stale_step` (snapshot auto-advance race).

  **(2) `RefloatPiggyLine.tsx` (~125 LOC)** : ligne 1 (tirelire). Theme violet. États : `active` (carte violet-50 avec "Disponible" + "À transférer" + bouton "Renflouer X€"), `done` (carte violet-50 avec "X utilisée pour combler" + "Il reste Y dans la tirelire"), `empty` (carte blanche "Pas d'argent dans la tirelire"), `unneeded` (carte blanche "Pas nécessaire — déficit comblé"). `useAmount = min(piggyAmount, deficitRemaining)`. Le done state préserve la couleur famille (violet) plutôt que de tomber en gray.

  **(3) `RefloatSavingsLine.tsx` (~170 LOC)** : ligne 2 (économies des budgets). Theme violet (même famille que tirelire). Reçoit `budgets: summary.budgets` (tous, pas filtré par parent) + filtre interne `cumulatedSavings > 0` pour le preview active. **Layout 2-lignes** par budget en état active : `[nom + delta]` sur la 1re ligne (`Courses` + `−50,00 €` en violet), `[before → after]` sur la 2e (`75,00 € → 25,00 €`). Preview calculé via `computeProportionalSavingsRefloat(deficitRemaining, savingsByBudget)`. Done state : phrase totale + liste de TOUS les budgets avec leur nouvelle `cumulatedSavings` (l'utilisateur voit les drained-to-0 vs remaining).

  **(4) `RefloatBudgetSnapshotLine.tsx` (~160 LOC)** : ligne 3 (équilibrage budgets). Theme orange (distinct famille tirelire/économies). **Bouton "Équilibrer"** (rename "Puiser" → "Équilibrer" demandé user pour cohérence métier). Layout 2-lignes preview par budget : `[nom + delta]` sur 1re (`Courses` + `+20,00 €` en orange), `[before → after / max]` sur 2e (`33,00 € → 53,00 € / 400,00 €`). Active utilise `computeProportionalBudgetSnapshot(deficitRemaining, budgets)`. Done state : phrase totale équilibré + liste budgets avec `consommé / estimé` (consommé = `carryoverSpentAmount + snapshotData[budgetId]`).

  **(5) `hooks/useMonthlyRecap.ts` étendu** : 3 nouvelles mutations.
  - `useRefloatFromPiggy(context)` : POST `/refloat-from-piggy` avec `{ amount }`. Response inclut `summary` fresh + `refloatedFromPiggy` cumulatif → `setQueryData` patche `summary` ET `recap.refloatedFromPiggy` (préserve `refloatedFromSavings` et `snapshotData` depuis l'ancien cache).
  - `useRefloatFromSavings(context)` : POST `/refloat-from-savings` (body `{ context }` only, server-computed allocation). Same setQueryData pattern.
  - `useSaveBudgetSnapshot(context)` : POST `/save-budget-snapshot`. Response sans `summary` ni trackers cumulatifs (juste `{ newDeficit, snapshot, perBudget, shortfall, nextStep }`). **NE PAS** `invalidateQueries` (provoquerait un page change vers SalaryUpdateStep dès que server auto-advance `current_step → 'salary_update'`). À la place : `setQueryData` patche uniquement `recap.snapshotData = data.snapshot`. Le bouton Continuer en bas drive l'advance final (via `useAdvanceStep` qui invalide, et swallow l'erreur si server déjà avancé).

  `MonthlyRecapStatusResponse` étendu avec sibling `recap: RecapProgress | null` (nullable pour rester tolérant des fixtures sprint 12 et états degraded). `RecapProgress = { id, currentStep, refloatedFromPiggy, refloatedFromSavings, snapshotData }`.

  **(6) Status endpoint étendu** ([app/api/monthly-recap/status/route.ts](../../app/api/monthly-recap/status/route.ts)) : quand `result.status.kind === 'in_progress'`, fetch en parallèle `loadRecapSummary` + `getActiveRecap` via `Promise.all`. Retourne `{ status, summary, recap }` au lieu de `{ status, summary }`. Sinon `recap: null`. Helper `coerceStep` local (mirror `lib/recap/check-status.ts`) car le pure module `deficit-math.ts` ne ré-exporte pas l'enum.

  **(7) `lib/recap/deficit-math.ts` (~55 LOC) — extraction pure CRITIQUE** : 3 helpers (`computeDeficitRemaining`, `sumSnapshotValues`, `coerceSnapshot`) extraits depuis `actions-negative.ts` qui importe `supabaseServer` (incompatible browser bundle). `actions-negative.ts` re-exporte les symboles pour préserver l'API publique et les tests existants. Barrel [lib/recap/index.ts](../../lib/recap/index.ts) re-exporte depuis le nouveau module. **Leçon barrel-leak** (cf. bug-fix commit `0a151c5`) : un client component faisant `import { computeDeficitRemaining, type RecapContext, type RecapSummary } from '@/lib/recap'` (value + types mixés depuis la barrel) cause Webpack en dev mode à pull `check-status.ts → supabaseServer` dans le browser bundle → crash `supabaseKey is required.` au module-load. Vitest avec Vite tree-shake mieux, donc les tests passent — le bug n'apparaît qu'au runtime browser. **Règle** : pour tout client component consommant un helper pur de `@/lib/recap`, importer la valeur DIRECTEMENT depuis le module pur (`@/lib/recap/deficit-math`) et garder la barrel pour `import type` seulement.

  **(8) `BudgetSummary.carryoverSpentAmount` ajouté** : colonne `estimated_budgets.carryover_spent_amount` (existait déjà en DB depuis sprint 02 V3) propagée à travers 3 fichiers :
  - `lib/recap/types.ts` : ajout champ obligatoire `carryoverSpentAmount: number` sur `BudgetSummary`.
  - `lib/recap/load-summary.ts` : SELECT étendu (`, carryover_spent_amount`) + mapping `carryoverSpentAmount: Number(b.carryover_spent_amount ?? 0)`.
  - `lib/recap/calculations.ts` : input `computeRecapSummary` accepte `carryoverSpentAmount?: number` (optionnel, défaut 0) + propage au output. Fixtures sprint-04 `calculations.test.ts` non-touchées grâce au default.

  Affichage : la ligne snapshot active utilise `consumedBefore = b.carryoverSpentAmount` pour le numérateur "X / Y" avant snapshot ; done state utilise `consumed = carryoverSpentAmount + snapshotData[budgetId]` pour la valeur finale post-snapshot (à finaliser sprint 08).

  **(9) Charte UI couleurs Popoth — formalisée et étendue** : convention installée et documentée dans les prompts sprints 14-17 (cf. commit `70ad690` qui ajoute la section "Code couleur UI Popoth" en tête de chaque prompt). Pattern :
  - **Tirelire** = violet (`bg-violet-50`, `border-violet-200`, `text-violet-800/900`) — déjà installé sprint 12.
  - **Économies des budgets** = violet (même famille tirelire — "stored value").
  - **Budgets** = orange (`bg-orange-50/100`, `border-orange-200/300`, `text-orange-800/900`).
  - **Deficit** = red (compteur header + alert).
  - **Surplus / succès** = green (transformations positives + snackbar `bg-green-600`).
  - **Neutral / locked / done-inactif / read-only** = `bg-white` (contraste vs fond bleu gradient page wizard `from-blue-50 to-indigo-100`). Anciennement `bg-gray-50` qui blendait avec le fond.

  Le done state des lignes actives (piggy + savings + snapshot) **garde sa couleur famille** plutôt que de tomber en gray — cohérence visuelle "tu as fait cette étape, elle reste de sa couleur".

  **(10) 5 scripts dev User B** ([scripts/seed-recap/](../../scripts/seed-recap/)) :
  - `_profile-b-lib.mjs` (~150 LOC) : helper variant de `_lib.mjs` hardcodé pour User B. Exporte `cleanupForB()` (wipe `monthly_recaps` + `estimated_budgets` + `real_expenses` + `real_income_entries` + reset piggy/bank pour User B) + `printForB({ scenarioKey, expectedBehavior, expectedFigures })` + re-export des helpers data-insert acceptant un profileId arbitraire.
  - `profile-b-budgets.mjs` : 5 budgets variés (Courses 400/75, Loisirs 150/0, Transport 80/40, Restos 200/0, Abonnements 50/25) — playground neutre sans expenses.
  - `profile-b-deficit-piggy-bascule.mjs` : déficit ~50€ / piggy 200€ → tirelire seule couvre + 150€ residual (test le "pas de bascule positive" — l'écran reste sur BilanNegativeStep en done state).
  - `profile-b-deficit-savings-cover.mjs` : piggy 20€ + savings pool 100€ couvrent déficit 120€ — test cascade 2 lignes (snapshot unneeded).
  - `profile-b-deficit-cascade.mjs` : cascade complète 100€+100€+300€=500€ déficit — les 3 lignes utilisées.
  - `profile-b-deficit-snapshot-only.mjs` : piggy=0 + savings=0 — ligne snapshot directement active dès l'ouverture.

  **Tests** : **Non-gated (+ 37 cas, 529 → 566)** :
  - `lib/recap/__tests__/deficit-math.test.ts` (9 cas pures : `sumSnapshotValues` 5 + `computeDeficitRemaining` 4 — couvre `null`/`undefined`/empty/non-empty/float-drift, sign de `initialBilan`).
  - `components/monthly-recap/__tests__/{RefloatPiggyLine,RefloatSavingsLine,RefloatBudgetSnapshotLine,BilanNegativeStep}.test.tsx` (7+7+5+10 = 29 RTL cas) : couvre les 4 états (`active`/`done`/`locked`/`empty`/`unneeded`) par composant, le wiring orchestrateur (gating cascade, deficit recompute, bascule supprimée, Continuer happy path + swallow `invalid_step`, snackbar succès).
  - `lib/recap/__tests__/actions-negative.test.ts` (14 cas existants — préservés via re-export depuis `deficit-math.ts`).
  - Fixture updates sprint 12 : `BilanPositiveStep.test.tsx` (5 sites), `RecapWizard.test.tsx` (mock `recap: null` + 3 nouveaux hook mocks), `SavingsDetailDrawer.test.tsx` / `SurplusDetailDrawer.test.tsx` / `SurplusSelectionDrawer.test.tsx` / `SummaryStep.test.tsx` (ajout `carryoverSpentAmount: 0` aux fixtures `BudgetSummary`).

  **Gated** : pas de nouveau test gated cette sprint (les 3 endpoints refloat ont leurs tests d'intégration livrés sprint 07). Compteur **164 inchangé**.

  **Conventions / leçons** :
  - **Barrel leak Webpack vs Vite** (bug critique attrapé au smoke test après ship initial) : un `import { value, type X } from '@/lib/recap'` (mixed value+type) pull la barrel en dev Webpack qui évalue tous les re-exports y compris ceux importing `supabaseServer`. Vite/Vitest tree-shake mieux donc tests verts. Détection seulement runtime browser. **Règle barrel safety** : pour client components, importer la valeur depuis le module source direct (`@/lib/recap/deficit-math`), garder la barrel pour `import type` only. Pattern formalisé dans la JSDoc du module.

  - **`setQueryData` vs `invalidateQueries` ratée la 1re fois** : initialement `useSaveBudgetSnapshot` utilisait `invalidateQueries` — provoquait page change vers SalaryUpdateStep dès que server auto-advance le step. Refactor : `setQueryData` ne patche QUE `recap.snapshotData` (pas `status.step`). Le wizard reste sur BilanNegativeStep, la card snapshot bascule en `done` localement, le bouton Continuer apparaît en bas. Le bouton drive l'advance final via `useAdvanceStep` (qui invalide). **Règle** : pour les mutations cascade qui doivent rester sur la page, ne JAMAIS mirror server-side auto-advances dans le cache client — laisser l'utilisateur driver le step transition via un bouton explicite.

  - **Gating order `unneeded` AVANT `locked`** : la 1re version mettait `locked` en priorité (savings est locked tant que piggy a de l'argent). Mais quand piggy couvre le déficit avec residual, savings devient `locked` ("Disponible après avoir transféré la tirelire") — message faux car la tirelire EST done. Correct : prioriser `deficitCovered → unneeded` ("Pas nécessaire — déficit déjà comblé") avant `locked`. Ordre canonique : `done > empty > deficitCovered (unneeded) > locked > active`.

  - **Pas de bascule positive** (drop demandé user) : la 1re version rendait `<BilanPositiveStep>` synthétiquement quand la tirelire seule couvrait le déficit avec residual. User a refusé cette page-jump : "Je ne veux pas qu'on change de page, je veux un feedback sur la même page". Solution finale : le piggy done state affiche "X utilisée + il reste Y dans la tirelire", savings + snapshot passent en `unneeded` (greyed avec message "Pas nécessaire — déficit comblé"), Continuer apparaît au bas. Le user reste maître de quand avancer vers salary_update.

  - **2-line preview layout** : la 1re version mettait `Courses 33,00 € / 400,00 € → 53,00 € / 400,00 € (+20,00 €)` sur 1 seule ligne — troncature garantie sur mobile 430px. Refactor : `[nom + delta]` sur la 1re ligne (nom à gauche, delta à droite avec sign+couleur), `[before → after / max]` sur la 2e (compact + lisible). Pattern applicable à tout preview list mobile-first dans le futur.

  - **Couleur famille préservée en done state** : la 1re version mettait toutes les cards done en `bg-gray-50` (signal "tu as terminé cette étape"). User a refusé : "les écrans de feedback ne respectent pas la charte graphique". Solution : done state garde la couleur famille (tirelire/économies violet, budgets orange), seules les cards INACTIVES (locked/empty/unneeded) passent en `bg-white`. Le user voit visuellement "ces lignes-ci sont mon chemin actif/passé, ces lignes-là sont neutralisées".

  - **`bg-white` vs `bg-gray-50` sur fond bleu gradient** : le fond de RecapShell est `bg-gradient-to-br from-blue-50 to-indigo-100`. `bg-gray-50` (très clair) blendait avec ce fond → mauvaise lisibilité des cards inactives. `bg-white` (totalement opaque) tranche nettement. Pattern applicable partout où le fond de page est saturé/coloré.

  - **`unneeded` state distinct de `locked`** : `locked` = "attend que la ligne précédente soit done" (message "Disponible après avoir transféré la tirelire"). `unneeded` = "déficit déjà comblé, pas besoin" (message "Pas nécessaire — déficit déjà comblé"). Distinction sémantique importante : le user comprend POURQUOI la ligne est greyée. Sans cette distinction, l'utilisateur pourrait croire qu'il manque une étape.

  - **Snackbar centralisée orchestrateur** vs per-line : la snackbar succès est managée au niveau `BilanNegativeStep` (`successMessage` state + `useEffect(setTimeout(setSuccessMessage(null), 3000))`). Chaque ligne reçoit un callback `onSuccess(message)` qui set le message au parent. Évite la duplication du `setTimeout` + cleanup dans chaque composant et garantit qu'une seule snackbar à la fois (mutation rapide successive remplace le message sans clash). Pattern miroir de `ProfileSettingsCard` (single source of truth pour transient feedback).

  - **Helpers User B variant** : `_lib.mjs` était hardcodé pour User A. Plutôt que de paramétrer les helpers (refactor riskier touchant 27 scripts existants), création d'un `_profile-b-lib.mjs` qui re-exporte les helpers data-insert acceptant déjà un profileId arbitraire + ajoute `cleanupForB()` et `printForB()` variants. Pattern duplication > paramétrisation quand le coût de paramétrer dépasse le coût de dupliquer 2 fonctions.

  - **Charte couleur formalisée pour sprints 14-17** : les 4 prompts suivants reçoivent en tête une section "Code couleur UI Popoth" listant les conventions (tirelire/économies = violet, budgets = orange, deficit = red, surplus = green, locked/empty/unneeded = gray ou bg-white). Note explicite : "vérifier les composants existants (BilanPositiveStep, BilanNegativeStep, RefloatPiggyLine, RefloatSavingsLine, RefloatBudgetSnapshotLine, SurplusSelectionDrawer) avant de choisir une couleur".

  **Files livrés** :
  - **Nouveaux** (9) : `lib/recap/deficit-math.ts`, `lib/recap/__tests__/deficit-math.test.ts`, `components/monthly-recap/{RefloatPiggyLine,RefloatSavingsLine,RefloatBudgetSnapshotLine}.tsx`, `components/monthly-recap/__tests__/{RefloatPiggyLine,RefloatSavingsLine,RefloatBudgetSnapshotLine,BilanNegativeStep}.test.tsx`.
  - **Modifiés** (10) : `components/monthly-recap/steps/BilanNegativeStep.tsx` (stub 20 LOC → ~190 LOC fonctionnel), `components/monthly-recap/RecapWizard.tsx` (passe `recap` au step négatif), `hooks/useMonthlyRecap.ts` (+3 mutations + `RecapProgress` interface), `app/api/monthly-recap/status/route.ts` (sibling `recap`), `lib/recap/{types,load-summary,calculations,actions-negative,index}.ts` (carryoverSpentAmount + re-exports), `components/monthly-recap/__tests__/{BilanPositiveStep,RecapWizard,SavingsDetailDrawer,SummaryStep,SurplusDetailDrawer,SurplusSelectionDrawer}.test.tsx` (fixture updates).
  - **Scripts dev** (5 nouveaux + 1 hors-sprint) : `scripts/seed-recap/_profile-b-lib.mjs`, `scripts/seed-recap/profile-b-{budgets,deficit-piggy-bascule,deficit-savings-cover,deficit-cascade,deficit-snapshot-only}.mjs`.
  - **Prompts** (4 modifiés) : `prompt-montly-recap/{14-screens-salary-final,15-carry-over-ui-rpcs,16-readonly-virtual-rows,17-integration-tests-e2e}.md` (section "Code couleur UI Popoth" ajoutée en tête).
  - **Hors scope DB** : aucune migration, aucune RPC. Les 3 endpoints refloat (`/refloat-from-piggy`, `/refloat-from-savings`, `/save-budget-snapshot`) étaient livrés sprint 07.

  **Commits** (6 incrémentaux, dont 1 bug-fix critique et 5 itérations UX successives basées sur retours user) :
  - `932354c` (feat) — impl initiale cascade 3 lignes + Continuer + bascule positive (later removed).
  - `0a151c5` (fix critique) — barrel leak `supabaseKey is required` au runtime browser ; import direct `from '@/lib/recap/deficit-math'`.
  - `3db77b9` (style) — lean snapshot card layout (titre + explication in-card + bouton 1-mot "Puiser" au bas).
  - `70ad690` (feat) — cascade séquentielle (gating 1 ligne active à la fois) + preview per-budget + setQueryData stay-on-page + snackbar succès centralisée + charte couleur violet/orange + scripts B (4 deficit scenarios) + section "Code couleur UI Popoth" dans prompts 14-17.
  - `b85f4a7` (feat) — done state enrichi (piggy "X utilisée / Y reste", savings + budgets listes nouvelles valeurs) + "Puiser" → "Équilibrer".
  - `f2e4009` (refactor) — drop bascule positive (stay-on-page partout) + état `unneeded` aux 3 lignes (déficit comblé en amont) + done state couleur famille (violet/orange au lieu de gray) + 2-line preview layout + `bg-white` pour cards inactives (contraste vs fond bleu gradient).

- ✅ **Sprint Screens-Salary-Final-V3** (sprint 14/17 Monthly Recap V3, livré 2026-05-25). Closes the wizard UI loop avec les deux derniers écrans (salary update optionnel + final recap qui finalise et redirige). Le user peut désormais dérouler un cycle Monthly Recap V3 complet de bout en bout via UI mobile. **Tests 566 → 599 non-gated** (+33 cas : 27 RTL sprint 14 + 6 RTL follow-ups). Routes API inchangées (les 3 endpoints `/update-salaries`, `/advance-step`, `/complete` étaient livrés sprint 08). 8 commits incrémentaux (1 main + 7 itérations basées sur retours user smoke-test).

  **Architecture installée** :

  **(1) `SalaryUpdateStep.tsx` (~210 LOC)** — écran 4. State local `decided: 'yes'|'no'|null` + 3 branches conditionnelles. **"Non"** → `useAdvanceStep({ fromStep: 'salary_update', toStep: 'final_recap' })`. **"Oui" + profile** → form 1-input pré-rempli via `useProfile().profile.salary`, submit POST `/update-salaries` (server auto-advance le step). **"Oui" + group** → délégue à `<GroupMemberSalaryForm>`. Callback `onSalaryUpdated()` propagé au parent (RecapWizard lift state) — fired uniquement sur succès update-salaries (pas sur Non).

  **(2) `GroupMemberSalaryForm.tsx` (~125 LOC)** — subforme group. Consomme `useGroupContributions()` (queryKey `['group-contributions']`) qui expose déjà `[{ profile_id, salary, profile: { first_name, last_name } }]`. **Pas de nouvel endpoint nécessaire** : `GET /api/groups/[id]/members` existe mais n'expose PAS le salaire — bypass via le hook existant. RHF dual-type `useForm<{members: Array<{profileId, salary}>}>` avec `zodResolver` + `z.coerce.number().nonnegative().finite()`. Form rendu seulement après load (gate sur `isLoading`) → évite le pattern `form.reset(defaultValues)` async. Skeleton mobile-first pendant fetch.

  **(3) `FinalRecapStep.tsx` (~290 LOC)** — écran 5. 3 cas de rendu :
  - **Cascade pos/nég** (`bilanSign === 'positive' && totalRefloated > 0`) : 2 sections "Renflouement initial : X€" avec breakdown par source + "Surplus transformé : +Y€ en économies". Forward-compatible — ne fire pas en sprint 13 actuel (BilanNegativeStep ne bascule pas vers PositiveStep), mais code prêt si la spec évolue.
  - **Positif pur** : "Vous avez transformé +X€ en économies" depuis `summary.totalSurplus`.
  - **Négatif pur** : "Vous avez renfloué votre déficit de X€" + breakdown par source (tirelire violet / économies violet / puisage budgets orange — couleurs charte sprint 13). Lignes > 0 uniquement.

  Ligne "Salaire mis à jour" / "Contribution mise à jour" affichée conditionnellement quand `salaryUpdated=true` (depuis profile.salary ou userContribution.contribution_amount). Bouton principal "Retourner au dashboard" → `useCompleteRecap`. **Idempotent** : POST `/complete` re-call renvoie `{ alreadyCompleted: true }` (HTTP 200), traité comme succès — le wizard redirige quand même via `useEffect(kind === 'completed')`.

  **(4) `hooks/useMonthlyRecap.ts` étendu** : 2 nouvelles mutations + 1 option.
  - `useUpdateSalaries(context)` : POST `/update-salaries` avec `{ context, salaries: [...] }`. onSuccess invalide `recapStatusKey(context)` + `['profile']` + `invalidateFinancialRefreshes(qc)` (clés financières incluent `['group-contributions']`). Le serveur auto-advance le step côté serveur, donc pas besoin d'`advance-step` explicite.
  - `useCompleteRecap(context)` : POST `/complete` avec `{ context }`. Response idempotente (`{ recapId, completed, snapshotApplied, transactions }` OU `{ alreadyCompleted: true, recap }`). onSuccess invalide status + financial refreshes (process_recap_transactions DELETE des real_expenses validées + apply snapshot UPDATE budgets carryover).
  - **`useMonthlyRecap(context, options?: { enabled? })`** : ajout option `enabled` pour conditional fetch. Defaults `true` (backward compat). Utilisé par RecapWizard pour peek conditionnel sur le group recap status (uniquement si `context === 'profile'` ET `profile.group_id` set).

  **(5) `RecapWizard.tsx` étendu** : 3 nouvelles capacités.
  - **Lift `salaryUpdated` state** : `useState(false)` au wizard, propagé via `onSalaryUpdated` à SalaryUpdateStep + `salaryUpdated` prop à FinalRecapStep. Refresh wizard reset à false (trade-off accepté — pas de tracking serveur).
  - **Peek group recap status** : `useMonthlyRecap('group', { enabled: peekGroupRecap })` avec `peekGroupRecap = context === 'profile' && profile?.group_id != null`. Dérive `groupRecapPending` consommé par 2 endroits : (a) la prop passée à FinalRecapStep pour le bouton label, (b) la logique de redirect dans `useEffect`.
  - **Redirect logic ternary** : `if (groupRecapPending) target = '/monthly-recap?context=group'` ; `else if (context === 'group') target = '/group-dashboard'` ; `else target = '/dashboard'`. Le user qui finit son recap perso ET dont le groupe n'a pas encore commencé son recap est nudgé vers le wizard groupe au lieu de retomber sur /dashboard (le proxy gating ne checke que le contexte navigué — sans cette logique, le recap groupe restait silencieusement pending).

  **(6) `RecapShell.tsx` étendu** — prop `headerLabel?: string | null`. Pill centrée au top de la shell, identifie pour qui le recap est fait. Profile : `Recap de <prénom>` (depuis `profile.first_name`). Group : `Recap du groupe « <name> »` (depuis `profile.group_name`, fallback `Recap du groupe`). Profile sans `first_name` chargé → null (skip rendu, évite "Recap de undefined" flicker). Style **nuances de gris** (`border-gray-300 bg-gray-50 text-gray-700 rounded-full`) — sobre, contraste lisible sur le fond bleu/indigo, ne compete avec aucune couleur métier (orange brand / violet tirelire / vert succès / rouge déficit). Première itération en teal, refusée par user : "partons sur des nuances de gris".

  **(7) Loader transition `RecapRedirecting`** — petit composant local dans RecapWizard. Centered `<Loader2 className="h-10 w-10 animate-spin text-orange-500">` + copy. Replace le précédent texte mono-ligne "Redirection…" / "Récap déjà terminé, redirection…" (les deux branches du wizard `status.kind === 'completed'` et `status.step === 'completed'`). `role="status" aria-live="polite"`.

  **(8) `useAdvanceStep` onError stale_step recovery** — nouvelle gestion d'erreur. Le serveur retourne 409 `stale_step` quand `current_step !== fromStep` (cas typique : snapshot save sprint 13 auto-advance server-side mais cache client reste sur `manage_bilan` pour afficher le snackbar + Continuer ; le clic Continuer fire advance-step `{ manage_bilan → salary_update }` qui collide). `BilanNegativeStep` swallow déjà l'erreur silencieusement mais `onSuccess` (= invalidate) ne fire pas car la mutation a erroré → wizard stuck sur step 3B jusqu'à refresh manuel. Fix : `onError: (error) => if (error.message === 'stale_step' || error.message === 'invalid_step') void qc.invalidateQueries({ queryKey: recapStatusKey(context) })`. Le refetch resyncs le cache avec l'état serveur et le wizard re-render au step actuel.

  **(9) `lib/recap/actions-salary.ts` — explicit `calculate_group_contributions` pour profile context** — refactor des conditions. Ancien comportement : RPC `calculate_group_contributions` appelée uniquement en `context === 'group'` (relyait sur le trigger DB `profiles_contribution_recalc` pour le cas profile-with-group). Smoke test sprint 14 a montré au moins un cas où le trigger ne propageait pas → header dashboard restait à "à définir". Nouveau : RPC appelée dès que `args.profile.group_id` non null, indépendamment du context. Le trigger reste comme backstop pour les mutations non-recap. Fail-soft préservé.

  **(10) Bg-white sur `DecimalFormInput` du salary form** — le shadcn `Input` default est `bg-transparent` ce qui blendait l'input avec le fond de la shell wizard. Fix par className `bg-white` explicite (1-line edit dans SalaryUpdateStep + GroupMemberSalaryForm).

  **(11) Seed script `chain-profile-done-group-pending.mjs` (~120 LOC)** — nouveau scénario QA. Profile A à `step='final_recap'` (parcours positif +200€), groupe G sans recap row → état `no_recap` côté serveur. Permet de smoke-tester le bouton "Aller au recap du groupe « X »" + le chain redirect en navigateur. `ensureGroupMembership()` vérifie A+B dans G (groupId hardcodé `92dbf6f2-7aa1-4f63-b31c-b85c57e3657e` matche celui demandé par le user).

  **Tests** (+33 cas non-gated, 566 → 599) :
  - `components/monthly-recap/__tests__/SalaryUpdateStep.test.tsx` (9 cas RTL — render profile/group, click Non, click Oui profile form, submit POST avec payload, click Oui group → subform, skeleton si profile pas loaded, role="alert" sur 500, disabled pending advance, disabled pending update).
  - `components/monthly-recap/__tests__/GroupMemberSalaryForm.test.tsx` (6 cas RTL — skeleton pendant fetch, role="alert" sur error, N inputs prefilled, fallback "Membre" si profile null, submit payload tuples corrects, disabled isSubmitting).
  - `components/monthly-recap/__tests__/FinalRecapStep.test.tsx` (12 cas RTL — positive/zero/negative paths, cascade pos/neg, salaryUpdated profile/group, click Retour fires mutation, pending Finalisation, role="alert" sur 500, null recap fallback, **3 cas chain-to-group** : groupRecapPending+groupName affiche "Aller au recap du groupe", groupRecapPending+null fallback "Retourner au dashboard", click chain fires complete).
  - `components/monthly-recap/__tests__/RecapWizard.test.tsx` (+3 redirect target cases : profile completed + group pending → `/monthly-recap?context=group`, profile completed + group completed → `/dashboard`, group context completed → `/group-dashboard`). Refactored mock setup : `mockResponses: Record<RecapContext, ...>` au lieu d'un single mock — mockStatus mirror sur les 2 contexts (backward compat), mockGroupStatus override le group seulement.
  - Mocks ajoutés (useProfile + useGroupContributions + useUpdateSalaries + useCompleteRecap) dans RecapWizard.test.tsx.

  **Conventions / leçons** :
  - **Conditional fetch via `enabled` option** : pattern propre pour skipper un fetch TanStack Query selon une condition (vs créer un hook séparé ou faire un fetch inline). L'option `enabled` est lue par TanStack — quand false, queryFn n'est pas appelée, data reste `undefined`. Backward-compatible : sans option, defaults à true.

  - **stale_step recovery au niveau hook** : un seul `onError` invalide le cache, vs gérer ça dans chaque call-site. Le call-site (`BilanNegativeStep`) continue de swallow l'erreur silencieusement (UX silencieuse), le hook fait le ménage côté cache. Séparation des responsabilités : UX → call-site, cache integrity → hook.

  - **Chain redirect — close proxy gating gap** : le proxy ne checke que le contexte navigué. Pattern : à la fin d'un recap, peek le statut de l'AUTRE contexte (si applicable) et redirige le user vers le wizard qui reste à faire. Évite que le user "oublie" un recap pending. Reverse direction (group → profile) non implémentée — le `/dashboard` proxy gate la catch déjà ; mais si le user atterrit sur `/group-dashboard` après un recap groupe et que son perso est pending, c'est laissé à un sprint futur (candidat followup).

  - **Lift transient flag plutôt que tracking serveur** : le flag `salaryUpdated` (true seulement après un submit salary réussi en cette session) est lifté au wizard via `useState`. Un refresh perd le flag → la ligne "Salaire mis à jour" disparaît. Trade-off accepté : pas de scope-creep server-side pour ce nice-to-have UI. Pattern applicable à tout signal éphémère cross-step dans un wizard.

  - **bg-white explicit sur shadcn Input avec parent coloré** : le default `bg-transparent` de [components/ui/input.tsx](../../components/ui/input.tsx) blende l'input avec le fond du parent. Sur fond bleu gradient (recap shell), pose `bg-white` via className. Pattern miroir de la règle sprint 13 "bg-white pour cards inactives sur fond bleu gradient".

  - **Couleur jamais utilisée = piste fragile** : la 1re itération du header pill utilisait teal-50/200/800 (jamais utilisé ailleurs dans le codebase). User a refusé : "partons sur des nuances de gris". Leçon : "jamais utilisé" ≠ "voulu". Pour les éléments d'identification (vs accent métier), le gris sobre est plus sûr — il ne suggère pas une sémantique nouvelle à apprendre. Couleurs accent doivent rester réservées aux signaux métier (tirelire violet, surplus vert, déficit rouge).

  - **Explicit > implicit pour les recalc DB** : abandonner l'hypothèse "le trigger va le faire" quand on a un endpoint qui peut explicitement appeler la RPC. Cas vu sprint 14 : profile context salary update relyait sur `profiles_contribution_recalc` trigger ; smoke test a montré au moins un cas de non-propagation. Fix : appel RPC explicite côté endpoint. Trigger reste comme backstop. **Règle** : pour les colonnes dérivées mises à jour par trigger, dans un endpoint qui MUTE la source, ajouter un appel explicite à la RPC de recalc (idempotent + cheap) plutôt que de relyer sur le trigger seul.

  - **Use existing hook over new endpoint** : pour le form group, plutôt que créer un endpoint `/api/groups/[id]/members?include=salary`, réutiliser `useGroupContributions` qui retourne déjà name + salary. Pattern : avant d'ajouter une route serveur, grep les hooks existants pour voir si la data est déjà fetched ailleurs.

  - **Charte couleur identifier vs accent** : les couleurs métier (orange brand / violet tirelire / vert succès / rouge déficit) doivent rester réservées à leur sémantique. Les éléments d'identification (header pill "Recap de X") prennent du gris neutre ou un accent jamais sémantique. Ne PAS multiplier les couleurs sémantiques — le user lit la couleur comme une information.

  **Files livrés** (sprint 14 + follow-ups) :
  - **Nouveaux** (5) : `components/monthly-recap/GroupMemberSalaryForm.tsx`, `components/monthly-recap/__tests__/{SalaryUpdateStep,GroupMemberSalaryForm,FinalRecapStep}.test.tsx`, `scripts/seed-recap/chain-profile-done-group-pending.mjs`.
  - **Modifiés** (8) : `components/monthly-recap/steps/{SalaryUpdateStep,FinalRecapStep}.tsx` (stub 20 LOC → ~210 LOC + ~290 LOC), `components/monthly-recap/{RecapWizard,RecapShell}.tsx`, `hooks/useMonthlyRecap.ts` (+2 mutations + enabled option + onError stale_step), `lib/recap/actions-salary.ts` (explicit RPC for profile context), `components/monthly-recap/__tests__/RecapWizard.test.tsx` (refactored mock setup + 4 new cases).
  - **Hors scope DB** : aucune migration, aucune RPC. Routes API toutes pré-existantes.

  **Commits** (8 incrémentaux, dont 7 follow-ups basés sur retours user smoke-test) :
  - `2459045` (feat) — sprint 14 main : 3 composants + 2 hooks + 12 tests RTL + RecapWizard wiring.
  - `2b14876` (fix follow-up) — input bg-white + RecapRedirecting loader + explicit calc_group_contributions for profile context.
  - `9c2d694` (fix follow-up) — useAdvanceStep onError invalidate on stale_step (close BilanNegativeStep race).
  - `2ff17e8` (feat follow-up) — chain redirect profile→group sur écran 5 quand group recap pending + useMonthlyRecap { enabled } option + 6 nouveaux tests.
  - `886c291` (test) — seed script chain-profile-done-group-pending.mjs.
  - `4b0670e` (feat follow-up) — header pill teal au top de RecapShell.
  - `ac172a8` (style follow-up) — header pill teal → nuances de gris (user pref).
