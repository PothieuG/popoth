# Roadmap détaillé — Part 21 : Screens-Welcome-Summary-V3 → Fix-Recap-Bilan-Formula

> Chronologie des sprints livrés à partir de 2026-05-23 (suite de [roadmap-detailed-20-salary-finalize.md](roadmap-detailed-20-salary-finalize.md)). Split préemptif : Part 20 (~36.6k chars post-sprint 10) aurait franchi le cap 39.5k en ajoutant le verbatim sprint 11.

## Sprints

- ✅ **Sprint Screens-Welcome-Summary-V3** (sprint 11/17 Monthly Recap V3, livré 2026-05-23). Remplit les stubs `WelcomeStep` + `SummaryStep` du wizard livré sprint 10. Ajoute 1 endpoint générique de transition (`/api/monthly-recap/advance-step`), 1 helper d'action pure (`executeAdvanceStep`), 2 mutations TanStack (`useStartRecap` + `useAdvanceStep`), 3 composants UI (`BilanBlock` + `SurplusDetailDrawer` + `SavingsDetailDrawer`), 1 helper format (`formatEuro` 2 décimales). 21 fichiers, +46 tests non-gated (459 → 505) + 6 tests gated (158 → 164). Routes API **37 → 38**.

  **Architecture installée** :

  **(1) Endpoint `POST /api/monthly-recap/advance-step`** (~90 LOC) : body `{ context, fromStep, toStep }` validé via nouveau `advanceStepBodySchema` (sprint 11 ajoute aussi `recapStepSchema` enum à [lib/schemas/recap.ts](../../lib/schemas/recap.ts)). Validation pipeline canonique : `withAuthAndProfile` → `parseBody` → group sans group_id (400) → `getActiveRecap` null (404 `no_active_recap`) → `started_by_profile_id !== userId` (403 `not_initiator`) → délégation à `executeAdvanceStep`. Mapping erreurs : `invalid_transition` (400 + fromStep/toStep echo), `stale_step` (409 + currentStep echo), `db_error` (500). Reload `loadRecapSummary` puis retour `{ data: { recap: {...recap, current_step: toStep}, summary } }` pour re-hydratation client en 1 round-trip.

  **(2) Helper pur `lib/recap/actions-advance.ts::executeAdvanceStep`** (~80 LOC) : (a) `isAdvanceAllowed(fromStep, toStep)` → false ⇒ `'invalid_transition'`. (b) `recap.current_step !== fromStep` ⇒ `'stale_step'` (client out-of-date). (c) UPDATE guardée concurrente : `UPDATE monthly_recaps SET current_step = toStep WHERE id = recap.id AND current_step = fromStep`. Si 0 rows affectés (autre client a déjà avancé) ⇒ `'stale_step'`. Si error supabase ⇒ `'db_error'`. Sinon `{ success: true, currentStep: toStep }`. 8 tests pure avec `supabaseServer` chainable mock couvrent les 4 outcomes + forward skip non-adjacent (welcome→final_recap pin documenté permissif par `isAdvanceAllowed`).

  **(3) `hooks/useMonthlyRecap.ts` étendu** : queryKey factory `recapStatusKey(context)`, ajoute `useStartRecap(context)` (mutation POST `/start`, idempotent côté serveur via `'resumed'` de la RPC, invalidate on success) et `useAdvanceStep(context)` (mutation POST `/advance-step` vars `{ fromStep, toStep }`, invalidate idem). Pas d'`setQueryData` optimistic — refetch fait son taf (staleTime 30s).

  **(4) WelcomeStep** (~75 LOC) : intro 2-paragraphes + bouton « Commencer ». `handleStart` chaîne `await useStartRecap.mutateAsync()` puis `await useAdvanceStep.mutateAsync({ fromStep: 'welcome', toStep: 'summary' })`. Erreurs UX-friendly via `ERROR_COPY` record (`locked_by_other` → message, `already_completed` → router.replace dashboard/group-dashboard, autres → copies dédiées). Bouton disabled pendant `isPending`. 7 tests RTL.

  **(5) SummaryStep** (~165 LOC) : 5 cards (Solde actuel, RAV estimé, RAV effectif, Surplus total, Total économies = `totalSavings + piggyAmount`) + `<BilanBlock>` + bouton « Étape suivante » → `useAdvanceStep({ summary→manage_bilan })`. **Color theming** (post-sprint Fix-Bilan-Formula) : sous-composant `SummaryCard` paramétré par `accent: 'bank' | 'neutral' | 'budget' | 'savings'` → `border-l-4` + amount text-color (sky-blue solde, slate RAVs, orange surplus = thème budget récap, violet économies). Pas de fond saturé. 6 tests RTL.

  **(6) BilanBlock** (~35 LOC) : composant pur, props `{ bilan, bilanSign }`. 3 variantes vert/rouge/neutre (border + bg + text). Messages copy : positive `"Vous allez pouvoir ajouter X à votre total d'économies."`, negative `"L'objectif est de revenir à l'équilibre."`, zero `"Le mois est équilibré."`. 3 tests RTL.

  **(7) SurplusDetailDrawer + SavingsDetailDrawer** (~85+95 LOC) : drawers indicatifs lecture-seule (aucune action). Structure miroir `<SavingsDistributionDrawer>` (Radix Dialog + `DRAWER_CONTENT_CLASSES` + `<ModalCloseX variant="circle" />`). Empty-state copy `"Aucun surplus ce mois-ci."` / `"Aucune économie pour le moment."`. SavingsDetailDrawer affiche la ligne Tirelire (skip si 0) puis les budgets avec `cumulatedSavings > 0`. **Color theming** : SurplusDetailDrawer header orange (border + bg-50 + icône cart bg-500 + titre 900 + amount 700) ; SavingsDetailDrawer header violet (mêmes shades). Cohérent avec les accents du SummaryStep. 4+4 tests RTL.

  **(8) `lib/format-currency.ts::formatEuro(n)`** (~15 LOC) : `Intl.NumberFormat('fr-FR', { style:'currency', currency:'EUR', minimumFractionDigits:2, maximumFractionDigits:2 })`. Garde defensive `!Number.isFinite(n)` → fallback 0. Cohabite intentionnellement avec `formatCurrency` (0 décimales) de `lib/contribution-calculator.ts` — surfaces distinctes (récap precision-cents vs dashboard arrondi). 6 tests.

  **Tests** :
  - **Non-gated (+ 46 cas)** : `format-currency.test.ts` (6) + `recap.test.ts` étendu (+9 cas schemas) + `actions-advance.test.ts` (8) + 5 composants RTL (3+4+4+7+6 = 24). RecapWizard.test.tsx étendu pour mocker `useStartRecap` + `useAdvanceStep`. **Compteur 459 → 505**.
  - **Gated `SUPABASE_RECAP_TESTS=1` (+ 6 cas)** : `advance-step/__tests__/route.integration.test.ts` couvre happy summary→manage_bilan + persistence + summary reload, happy welcome→summary, invalid_transition (400), stale_step (409), not_initiator group (403), no_active_recap (404). **Compteur 158 → 164**.

  **Conventions / leçons** :
  - **Idempotence WelcomeStep via RPC `start_monthly_recap`** : la RPC retourne `'created' | 'resumed' | 'completed' | 'locked_by_other'`. Le `'resumed'` permet de re-appeler `/start` sans crash quand le row existe déjà pour le même initiateur. Donc WelcomeStep chaîne `/start` + `/advance-step` sans branchement `mode: 'first_start' | 'resume'` — une seule code-path pour no_recap première fois ET in_progress + step='welcome' après refresh. Simplicité > optimisation (skip /start si in_progress aurait économisé 1 round-trip mais ajoute branching).

  - **UPDATE WHERE current_step + check 0 rows = race-safe stale_step** : le pattern guardé évite l'overwrite si 2 clients avancent en parallèle. Le 2e client voit `data.length === 0` et reçoit `'stale_step'` plutôt que de polluer la state machine. Pattern reproductible pour toute mutation conditionnelle sur état observable côté client.

  - **2 helpers de format coexistent** : `formatEuro` (2 décimales, [lib/format-currency.ts](../../lib/format-currency.ts)) pour récap precision-cents et `formatCurrency` (0 décimales, [lib/contribution-calculator.ts](../../lib/contribution-calculator.ts)) pour dashboard arrondi. Ne pas unifier sans peser les consumers — l'arrondi-0 est un choix UX volontaire pour les chiffres synthétiques. Cohabitation documentée dans file-header de `format-currency.ts`.

  - **Test apostrophes UTF-8 ASCII** : les messages d'erreur copy utilisent `"L'étape"` (ASCII U+0027) plutôt que `"L'étape"` (typographique U+2019). Cohérence test regex `/L'étape/` vs source string — sinon mismatch invisible à l'œil. Convention sur tout nouveau message d'erreur copy.

  - **NBSP vs narrow no-break space dans Intl.NumberFormat** : Node 20+ utilise U+202F (narrow no-break space) comme séparateur de milliers fr-FR, U+00A0 (NBSP) entre nombre et symbole €. Le test regex `/1\s234,56/` matche les deux via `\s`. Ne pas hardcoder un seul caractère whitespace.

  - **Re-entrée wizard = retour EXACT step + sub-state** (RÈGLE PERSISTANTE per user 2026-05-23, mémoire `feedback_recap_exact_reentry.md` + CLAUDE.md §5 ⚠️) : sprint 11 = trivial (RecapWizard route déjà sur `status.step`). Sprint 12+ (manage_bilan négatif multi-étapes) devra persister sous-états côté serveur (`refloated_from_piggy`, `refloated_from_savings`, `budget_snapshot_data` — colonnes déjà présentes sprint 07) pour reprendre mid-flow.

  **Files livrés** :
  - **Nouveaux** (14) : `lib/format-currency.ts`, `lib/recap/actions-advance.ts`, `app/api/monthly-recap/advance-step/route.ts`, `components/monthly-recap/{BilanBlock,SurplusDetailDrawer,SavingsDetailDrawer}.tsx`, `lib/__tests__/format-currency.test.ts`, `lib/recap/__tests__/actions-advance.test.ts`, `components/monthly-recap/__tests__/{BilanBlock,SurplusDetailDrawer,SavingsDetailDrawer,WelcomeStep,SummaryStep}.test.tsx`, `app/api/monthly-recap/advance-step/__tests__/route.integration.test.ts`.
  - **Modifiés** (7) : `hooks/useMonthlyRecap.ts` (+2 mutations), `lib/schemas/recap.ts` (+2 schemas), `lib/schemas/__tests__/recap.test.ts` (+9 cas), `components/monthly-recap/steps/{Welcome,Summary}Step.tsx` (stubs remplis), `components/monthly-recap/__tests__/RecapWizard.test.tsx` (mock étendu), `CLAUDE.md` (§5 condensé + §5.5 + §11).
  - **Mémoire** : `feedback_recap_exact_reentry.md` (cross-session).
  - **Hors scope** : aucune modif DB, aucune RPC. La feature « advance step explicite » est implémentée 100% côté app (validation pure TS `isAdvanceAllowed` + UPDATE simple).

- ✅ **Sprint Fix-Recap-Bilan-Formula** (livré 2026-05-24). **Correction critique** : la formule du bilan dans `computeRecapSummary` ([lib/recap/calculations.ts](../../lib/recap/calculations.ts)) était `bilan = ravEffectif + ravEstime` (ADDITION) depuis sprint 04 — bug introduit lors de la livraison du module pure. Spec produit + demande user 2026-05-24 : `bilan = ravEffectif - ravEstime` (**SOUSTRACTION**). Le bug était silencieux côté code (les tests passaient car re-engineered autour de la mauvaise formule) mais bloquant côté produit : sous addition, deux RAV négatifs (mois pourri) produisent un bilan plus négatif que la réalité, et l'écran 2 affichait des bilans absurdes au smoke test sprint 11.

  **Sémantique correcte** :
  - `bilan > 0` ⇒ `ravEffectif > ravEstime` ⇒ on a dépensé **MOINS** que prévu ⇒ mois positif, on peut épargner la différence.
  - `bilan < 0` ⇒ `ravEffectif < ravEstime` ⇒ on a dépensé **PLUS** que prévu ⇒ mois déficitaire, à renflouer via piggy/savings/snapshot.
  - `bilan = 0` ⇒ mois exactement comme prévu ⇒ équilibre, transition directe vers salary_update.

  **Files modifiés (8)** :
  - **Code** : `lib/recap/calculations.ts` (operator `+` → `-` ligne 51 + docstring), `lib/recap/types.ts` (commentaire `RecapSummary.bilan` réécrit avec sémantique correcte).
  - **Tests** : `lib/recap/__tests__/calculations.test.ts` (4 cas re-engineered avec nouvelles paires input/expected qui préservent l'intention originale : positive / zero / negative / cents-precise via `ravEffectif - ravEstime`).
  - **Specs prompt** : `prompt-montly-recap/00-Detailed_feature.md` (2 spots : tableau §3 + écran 2 §4.2), `prompt-montly-recap/04-calculations.md` (5 spots : commentaire TS interface, docstring `computeRecapSummary`, impl ligne 109, test list ligne 181 + 183, ❌ rule §"Pièges").
  - **Color theming SummaryStep + drawers** (bundled dans le même commit `cb304c2`) : `components/monthly-recap/steps/SummaryStep.tsx` (sous-composant `SummaryCard` paramétré par `accent`, 4 variantes border-l + amount text), `components/monthly-recap/SurplusDetailDrawer.tsx` (header orange-50 + icône bg-orange-500), `components/monthly-recap/SavingsDetailDrawer.tsx` (header violet-50 + icône bg-violet-500). Discrétion volontaire (border + text-color, pas de fond saturé sur les cards).

  **Hors scope (volontairement non-touché)** :
  - `.claude/history/roadmap-detailed-18-modal-enter-block.md:186` mentionne `bilan = round2(ravEffectif + ravEstime)` dans le verbatim du sprint Calculations-V3 — **laissé tel quel** per [size-policy.md](../guardrails/size-policy.md) §7 "history append-only verbatim". L'historique documente fidèlement la formule bugguée telle qu'elle a été shippée au sprint 04.
  - Les seeds CLI `scripts/seed-recap/*.mjs` documentent des bilans attendus dans leurs `printPostSeedInstructions({ expectedFigures: { Bilan: X } })` — la plupart restent valides (les seeds construisent les data brutes, la formule reste cohérente avec leur intention business). Divergences éventuelles corrigées sprint par sprint au fil des smoke tests sprint 12+.

  **Conventions / leçons** :
  - **Bug-trap "tests passent mais sémantique fausse"** : les tests calc-rtl avaient été écrits AUTOUR de la mauvaise formule (les inputs produisaient les outputs attendus par construction inverse), donc la suite restait verte. Détection seulement au smoke test UI quand le user a vu un bilan absurde. Leçon : pour les formules métier critiques, écrire d'abord au moins 1 cas test EN VALEURS PROVENANT DE LA SPEC (« la doc dit que 2400-2300=100 doit donner bilan=100 »), pas seulement en cas dérivés via `inputProducingExpected` calculé à l'envers.

  - **Cohabitation prompt-spec ↔ impl** : la spec sprint 04 DÉCRIVAIT déjà la mauvaise formule (5 occurrences). Le sprint 04 a transcrit la spec verbatim sans re-vérifier la sémantique business. Convention : avant de copier une formule de la spec, valider sa cohérence business avec 1 cas concret (« si X et Y, j'attends Z »). Si la spec est ambiguë ou fausse, la corriger AVANT l'impl.

  - **6 fichiers spec mis à jour en cascade** : un changement de formule métier requiert grep cross-codebase (impl, types comment, tests, specs prompt, ❌ rules). `Grep "ravEffectif\\s*\\+\\s*ravEstime"` cross-codebase est le filet minimum à passer avant commit.
