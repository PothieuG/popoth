# Part 46 — Renflouement manuel du déficit (2026-10-01)

> 1 sprint. Refonte de l'écran « Gestion du déficit » (étape 4 du récap quand
> le bilan est négatif) à la demande de l'utilisateur, à partir de son récap de
> septembre 2026 : surplus des budgets **1 129,87 €**, bilan **−348,06 €**, et
> l'app proposait de prélever les 348,06 € sur les budgets d'octobre
> (proportionnellement) pendant que le surplus disparaissait.
> Migration `20261001000000_recap_manual_refloat_plan.sql` (4 colonnes, 2 RPCs).

## 1. Le constat (bug + manque produit)

- **Bug** : en bilan négatif, le surplus des budgets n'était JAMAIS transformé.
  Seul le flux positif le versait en économies (`executeTransformRemainingToSavings`
  au « Continuer »). En négatif, rien → il disparaissait à la clôture (le mois
  suivant repart de zéro), même quand la tirelire suffisait à couvrir le déficit.
  Probable cause d'un « Total des économies : 0 € » chez l'utilisateur (non vérifié
  en base).
- **Double peine** : surplus perdu ET budgets du mois suivant amputés. Le vrai
  résultat du mois était positif : `ravEffectif + totalSurplus` = −348,06 + 1 129,87
  ≈ +781,81 € (le RAV compte les budgets à leur montant prévu, pas au dépensé).
- **Manque produit** : cascade imposée (tirelire → économies → projets →
  budgets), proportionnelle, sans choix de l'utilisateur.

## 2. Décisions produit (validées par l'utilisateur)

1. **Surplus → économies** automatiquement entre l'étape 3 et l'étape 4 (chaque
   budget garde son propre surplus).
2. **3 sections dépliables** (tirelire / budgets / projets), ordre libre, curseur
   - montant saisissable. Budget : limite = économies + montant du budget ; on
     prend d'abord les économies, puis le budget du mois suivant (ex. 100 € + 30 €
     d'économies : 20 € → 10 € d'économies restantes ; 50 € → 0 € d'économies et
     80 € de budget en octobre).
3. **Projets : mensualité seule**, l'argent déjà épargné reste protégé
   (l'échéance recule, mécanique existante `pending_delay_fraction`).
4. **Bouton « Répartir le reste automatiquement »** gardé, facultatif (économies
   d'abord au prorata des économies, puis budgets au prorata de leur montant).
5. **Débit différé** : « Valider » enregistre un plan, tout est appliqué à la
   finalisation ; le plan reste modifiable.
6. **« Continuer » obligatoire à 0 €**, sauf si plus aucune source ne peut rien
   donner (« Continuer sans tout renflouer »).
7. Reste à renflouer **toujours visible** (bandeau collant).

## 3. Implémentation

**DB** (`20261001000000`) — `monthly_recaps` + 4 colonnes nullables SANS défaut
(NULL = « pas encore fait » ; pas de faux diff en prévisualisation de
restauration de snapshot mensuel) : `surplus_savings_data` (jsonb),
`planned_piggy_refloat` (numeric, CHECK ≥ 0), `planned_savings_refloat` (jsonb),
`refloat_plan_applied_at` (timestamptz). La part « budget du mois suivant »
réutilise `budget_snapshot_data` (finalize en écrasement inchangé), la part
projets `project_snapshot_data`.

- `transfer_recap_surplus_to_savings(p_recap_id, p_allocations)` : ligne du
  récap `FOR UPDATE`, no-op si déjà fait → un double appel (double montage
  React, 2 onglets) ne crédite jamais deux fois. Owner-scoped, tout ou rien.
- `apply_recap_refloat_plan(p_recap_id)` : débite tirelire
  (`update_piggy_bank_amount`) + économies, pose `refloat_plan_applied_at` dans
  la même transaction → finalize rejoué = 0 double débit. Exception si une
  économie deviendrait négative → rollback total → warning
  `apply_refloat_plan_failed`.
- `EXPECTED_RPCS` 28 → 30.

**Serveur** — `lib/recap/refloat-plan.ts` (pur, partagé navigateur/serveur) :
`planFromRecapRow/Progress`, `deficitRemainingForPlan`, `planWithoutSource`,
`splitBudgetRefloat`, `budgetRefloatCapacity`, `autoDistributeBudgets`,
`remainingRefloatCapacity`, `canLeaveDeficitStep`.
`lib/recap/actions-negative.ts` réécrit : `executePrepareDeficit` +
`executeSaveRefloatPlan` (REMPLACE la valeur de la source ; bornes : tirelire ≤
solde, budget ≤ économies + budget, projet ≤ mensualité, total ≤ reste sans la
source). Routes `POST /prepare-deficit` + `POST /save-refloat-plan` (step
`manage_bilan` seul). `advance-step` ré-applique `canLeaveDeficitStep` → 409
`deficit_not_covered`. `computeRecapSummary` consomme `surplusSavingsData` comme
`piggyTransfersData`. `executeCompleteRecap` : `apply_recap_refloat_plan` en
étape 0.

**UI** — `BilanNegativeStep` réécrit + `DeficitProgressHeader` (sticky
`top-[env(safe-area-inset-top)]`, 3 compteurs en grille fixe : la hauteur ne
bouge pas pendant le glissement), `RefloatSection` (pied Annuler/Valider collant
en bas), `RefloatPanels`, `RefloatSlider` (range natif + piste dessinée :
violet économies → orange budget, grisé au-delà du reste à renflouer ; piste
rentrée de ½ pouce pour l'alignement), `RefloatAmountInput` (16 px anti-zoom
iOS). Pas de snackbar après « Valider » : elle masquait le pied collant de la
section suivante → coche verte dans l'en-tête + `role=status` sr-only.
`FinalRecapStep` : détail tirelire / économies / budgets du mois prochain /
projets + surplus rangé ; `CascadeSummary` (jamais déclenché) supprimé.

**Supprimé (Path B)** : routes `refloat-from-{piggy,savings,projects}` +
`save-budget-snapshot` (+ leurs tests gated), `Refloat{Piggy,Savings,Projects,
BudgetSnapshot}Line` (+ tests), `computeProportional{Savings,Budget,Projects}*`,
schémas Zod associés. Routes 48 → 46.

**Rétro-compatibilité** : `refloated_from_piggy/savings` (argent DÉJÀ débité par
l'ancienne cascade sur un récap ouvert avant le déploiement) restent soustraits
du déficit et affichés (« Déjà renfloué… non modifiable ») ; le balayage des
récaps abandonnés (Part 41) continue de les rembourser. Un récap en cours à
`manage_bilan` reçoit son versement surplus → économies à la réouverture de
l'écran.

## 4. Vérification

- `typecheck` / `lint:check` / `format:check` verts ; `test:run` 1088 passed /
  227 skipped ; `build` OK (env factices).
- Nouveaux tests : `refloat-plan.test.ts`, `actions-negative-plan.test.ts`
  (supabase mocké), `RefloatControls.test.tsx`, `BilanNegativeStep.test.tsx`
  réécrit, `actions-finalize.test.ts` étendu, gated
  `save-refloat-plan/__tests__/route.integration.test.ts` (parcours bout en
  bout + concurrence ; **non exécuté dans la session**, faute de base).
- Rendu vérifié en Chromium 390 × 844 (page de prévisualisation temporaire, non
  commitée).

## 4 bis. Application sur dev (2026-10-01, accord utilisateur)

- `apply-sql.mjs` avec `SUPABASE_PROJECT_REF=ddehmjucyfgyppfkbddr` explicite
  (le script vise la prod par défaut). Pré-check lecture seule : colonnes et
  fonctions absentes, `update_piggy_bank_amount` présente, 1 récap ouvert.
- Dev a un tracker `schema_migrations` à jour (72 lignes) contrairement à
  multi-env.md §6 (2026-05-29) → version `20261001000000` inscrite (73).
- **Trouvaille sécurité** : après application, les 2 RPC étaient EXECUTE pour
  `anon` + `authenticated` (privilèges par défaut Supabase, que
  `REVOKE … FROM PUBLIC` ne retire pas). Migration corrigée (REVOKE explicite)
  et appliquée sur dev → `postgres` + `service_role` seuls. **Toutes les RPC
  finance antérieures sont dans ce cas sur dev** (`update_piggy_bank_amount`,
  `update_budget_cumulated_savings`, `start_monthly_recap`…) : hors périmètre,
  à traiter dans un sprint dédié (vérifier d'abord la prod).
- Smoke test SQL dans une transaction volontairement annulée (`RAISE` final) :
  surplus crédité une fois (10 + 200 = 210), 2e appel no-op ; plan appliqué
  (tirelire 100 → 0, économies 210 → 0), 2e application no-op ; économie
  négative refusée. 0 ligne résiduelle vérifiée. `db:check-rpcs` (dev) : 30/30.

## 4 ter. Application en prod (2026-10-01, accord utilisateur)

- Pré-check lecture seule : colonnes/fonctions absentes, tracker 72 lignes
  (dernière `20260928000000`), 1 récap ouvert (septembre 2026, groupe, étape
  `complete_month`, aucun renflouement déjà débité → il passera par le nouvel
  écran sans cas de rétro-compatibilité).
- `apply-sql.mjs` (HTTP 201) + `INSERT` dans `schema_migrations` (73 lignes).
  Droits EXECUTE des 2 RPC : `postgres` + `service_role` seuls (REVOKE inclus
  dans la migration dès le départ).
- `db:check-rpcs` 30/30, `db:types` (seul écart : mise en forme du générateur),
  `db:check-types-fresh` OK, baseline ré-exportée (4 colonnes + CHECK) →
  `db:check-drift` OK, `db:audit-functions` / `db:check-rls` /
  `db:check-functions` OK. Code : `dev` avancé puis `main` en fast-forward.

## 4 quater. CI rouge sur `main` après le déploiement (2026-10-01)

- Test `AddBudgetDialog` « setFocus on invalid empty name » rouge en CI (déjà
  rouge sur `dev` au run 69, sur `5abae49`, avant ce sprint). Le `waitFor` de
  `6b760c5` ne suffisait pas : ce n'était pas une course d'assertion.
- **Cause** (sonde sur `focus()`) : RHF passe `isSubmitting` à `true` dès le
  début de `handleSubmit`, validation comprise. Le champ `disabled={isSubmitting}`
  est encore désactivé quand `onInvalidSubmit` appelle `setFocus` → rien ; seul
  le rattrapage `setTimeout` de RHF peut réussir, selon l'ordre des rendus.
  Dans l'app, même effet possible (curseur pas sur le champ à corriger).
- `9fa820c` : `AddBudgetDialog` ne désactive plus le champ (soumission
  synchrone). Run suivant : `main` vert, `dev` rouge sur `EditIncomeDialog`
  (même cause, soumission asynchrone) → hook `useFocusFirstError` (focus dans
  un effet, après le rendu qui ré-active les champs) branché sur
  `EditIncomeDialog` + `AddTransactionModal`, 3 tests dont un qui coupe le
  rattrapage RHF (`shouldFocusError: false`) et un vérifié par mutation.
  Les ~15 autres formulaires : tâche de suivi proposée.

## 5. Leçons

- **Un écran de « cascade » cache facilement un flux d'argent orphelin** : le
  surplus n'avait de destination que dans la branche positive. Pour toute
  branche du récap, se demander où va chaque euro (surplus, tirelire, dette).
- **Différer les débits rend l'UX réversible gratuitement** (plan modifiable,
  rien à rembourser à l'abandon) ; l'idempotence se règle une fois, dans la RPC
  d'application (`refloat_plan_applied_at` posé dans la même transaction).
- **Sur Supabase, `REVOKE … FROM PUBLIC` ne protège pas une RPC** : retirer
  aussi `anon, authenticated` et vérifier `information_schema.routine_privileges`
  après application.
- **Un `waitFor` qui ne suffit pas n'est pas une course d'assertion** : sonder
  l'état réel (ici `disabled` au moment de `focus()`) avant de « stabiliser »
  un test ; un test rouge aléatoirement révèle souvent un défaut de l'app.
- **`wc -m` sans locale `en_US.UTF-8` installée compte des octets** : mesurer
  avec `pnpm check:md-size` (points de code), sinon fausse alerte au plafond.
- **`next dev` (16.3) ajoute un bloc `nextjs-agent-rules` à `CLAUDE.md`** : ne
  pas le commiter (plafond 39,5k), restaurer le fichier après un `pnpm dev`.
