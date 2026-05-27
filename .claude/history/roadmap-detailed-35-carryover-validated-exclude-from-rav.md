# Roadmap détaillée — Part 35 : Carry-Over Validated Exclude From RAV

> Append-only chronologique. Voir [CLAUDE.md §11](../../CLAUDE.md) pour l'index global. Part précédente : [Part 34](roadmap-detailed-34-allow-negative-rav-and-deficit-bug.md) (Allow-Negative-RAV + carryover fixes).

---

- ✅ **Sprint Carry-Over-Validated-Exclude-RAV** (livré 2026-05-27). Corrige le double-comptage cross-mois lors de la validation d'une dépense/revenu reportée du mois précédent (long-press → "Valider"). Avant : la validation modifiait à la fois le solde bancaire **et** le RAV + "dépensé sur ce budget" + déficit éventuel du mois courant — c'était l'intention de design Sprint 15 V3 ("carry-over validé = transaction normale du mois courant") mais elle aboutissait à un double-comptage : la dépense impactait déjà le RAV de son mois d'origine, et impactait à nouveau le RAV du mois courant lors de la validation. Après : seul le solde bouge à la validation, le RAV / budget spent / déficit du mois courant restent intacts. **Décision business confirmée user 2026-05-27** : la dépense reportée appartient au mois d'origine ; la validation post-recap est un acte de paiement, pas une nouvelle dépense du mois courant.

  **Architecture installée** :

  **(1) Nouveau filtre canonique** : `.is('carried_from_recap_id', null)` à la place de `.eq('is_carried_over', false)` sur tous les SELECTs contribuant aux calculs current-month. Le champ `carried_from_recap_id` est préservé par les RPCs `toggle_carry_over_and_apply{,_income}` (règle Sprint 15 V3 — mémoire bidirectionnelle), donc une carry-over validée garde `carried_from_recap_id != null` et le filtre canonique l'exclut. Couvre les 3 états :
  - Transaction pure du mois : `carried_from_recap_id=NULL` → inclus.
  - Carry-over état A (en attente) : `is_carried_over=true, carried_from_recap_id != null` → exclu.
  - Carry-over état B (validé post long-press) : `is_carried_over=false, carried_from_recap_id != null` → **exclu (FIX)**.

  **(2) 10 sites de calcul migrés** :
  - [lib/finance/financial-data.ts](../../lib/finance/financial-data.ts) — 2 SELECTs (`real_income_entries` L116-120, `real_expenses` L131-138). Commentaires §4 + §5 réécrits pour refléter la nouvelle sémantique (les 2 états sont exclus, pas seulement state A).
  - [lib/finance/income-compensation.ts](../../lib/finance/income-compensation.ts) — 1 SELECT.
  - [lib/finance/budget-savings-detail.ts](../../lib/finance/budget-savings-detail.ts) — 1 SELECT.
  - [lib/api/finance/expenses-progress.ts](../../lib/api/finance/expenses-progress.ts) — 2 SELECTs (profile + group).
  - [lib/api/finance/income-progress.ts](../../lib/api/finance/income-progress.ts) — 2 SELECTs (profile + group).
  - [lib/api/finance/budgets-estimated.ts](../../lib/api/finance/budgets-estimated.ts) — 2 SELECTs (L84 dans map callback + L227).
  - [lib/api/finance/expenses-preview-breakdown.ts](../../lib/api/finance/expenses-preview-breakdown.ts) — 1 SELECT (preview cascade auto-piggy).
  - [lib/api/finance/expenses-add-with-logic.ts](../../lib/api/finance/expenses-add-with-logic.ts) — 1 SELECT (cascade ADD).
  - [lib/api/finance/expenses-real.ts](../../lib/api/finance/expenses-real.ts) PUT — 1 SELECT (delta-cascade edit-mode L411-418).
  - [lib/recap/load-summary.ts](../../lib/recap/load-summary.ts) — 1 SELECT (recap mensuel actif).

  **(3) Sites volontairement non modifiés** :
  - GET handlers de listing (`/api/finance/{expenses,income}/real` GET) — l'UI doit continuer à afficher les carry-overs avec badge "Mois précédent". Aucun filtre carry-over n'est posé là (règle Sprint 15 V3 préservée).
  - [lib/finance/planner-emptiness.ts](../../lib/finance/planner-emptiness.ts) — décision user Sprint Salary-Edit-Gating : carry-overs comptent comme contenu non-vierge. Garder.
  - [lib/recap/actions-finalize.ts](../../lib/recap/actions-finalize.ts) + RPC `process_recap_transactions` — la RPC DB qui FAIT la transition `is_carried_over=false → true` au finalize utilise toujours sa propre logique `is_carried_over` (côté SQL, non touché par le sprint).

  **(4) Aucune migration DB** : le changement est purement applicatif (filtre côté SELECT). Les RPCs `toggle_carry_over_and_apply{,_income}` continuent d'écrire `applied_to_balance_at=NOW()` + débiter le solde — comportement voulu. Le champ `carried_from_recap_id` est déjà persisté comme mémoire bidirectionnelle (règle Sprint 15 V3).

  **(5) Follow-up "Mois d'origine" sur le badge carry-over (2026-05-27)** : remplace le libellé fixe "Mois précédent" du badge gris ([TransactionListItem.tsx](../../components/dashboard/TransactionListItem.tsx)) par le mois d'origine de la transaction (e.g. "Avril 2026"), formaté depuis `expense_date` / `entry_date` (champs jamais modifiés par les RPCs même quand la transaction est cascadée plusieurs mois). Pertinent pour les transactions qui traînent 2+ mois sans validation : le libellé "Mois précédent" devient ambigu, "Avril 2026" identifie le mois d'origine sans ambiguïté. Helper pur `formatTransactionOriginMonth(transaction, type)` : `Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })` + capitalisation du premier char. Fallback "Mois précédent" si la date est manquante/mal formée. +1 cas test "Part 35: badge reflects expense_date even when carried multiple months" + test existant updaté (assertion "Mai 2026" au lieu de "Mois précédent" — la fixture `buildExpense` a `expense_date='2026-05-21'`).

  **Tests** (+2 cas non-gated + extension fixture gated) :
  - [lib/finance/**tests**/financial-data.test.ts](../../lib/finance/__tests__/financial-data.test.ts) — describe "carry-over filter" :
    - Renommé "(Sprint 15)" → "(Sprint 15 + Part 35)".
    - Fixture étendue : +1 expense state B (60€, `is_carried_over=false, carried_from_recap_id=<recap_id>, applied_to_balance_at=NOW()`) + 1 income state B (90€).
    - Assertions existantes préservées (`totalRealExpenses=150`, `totalRealIncome=300`, `remainingToLive=150`) — sans le fix, elles auraient cassé (la state B aurait été incluse, élevant totals à 210/390 + RAV à 180).
    - +1 cas explicite "Part 35 regression-guard: state B carry-over (validated post long-press) is excluded from RAV" qui ré-asserte explicitement les 3 totaux avec commentaire inline du delta attendu sans fix.
  - [lib/finance/**tests**/financial-data-bug-repro.test.ts](../../lib/finance/__tests__/financial-data-bug-repro.test.ts) — mock builder étendu pour supporter `.is(col, null)` (nouveau type filter `is`). Note ajoutée en docstring : les fixtures n'ont pas de `carried_from_recap_id` défini (undefined ≡ NULL), donc les assertions existantes restent valides.

  **Sémantique métier (rappel)** :
  - Dépense créée mois N (état initial) → impacte le RAV du mois N (la formule RAV agrège toutes les real_expenses du contexte).
  - Mois N close (finalize wizard) → si non-validée, RPC `process_recap_transactions` flag `is_carried_over=true, carried_from_recap_id=<recap_N_id>`. Le RAV mois N est snapshotté.
  - Mois N+1 dashboard → carry-over visible avec badge "Mois précédent", **exclu de tous les calculs** (RAV, solde, budget spent, déficit). User peut valider/supprimer.
  - Mois N+1 user valide (long-press) → RPC `toggle_carry_over_and_apply` flip `is_carried_over=false, applied_to_balance_at=NOW()` + débit solde. `carried_from_recap_id` préservé.
  - **Avec le fix Part 35** : le RAV mois N+1 et les compteurs current-month restent intacts. Seul le solde bouge. La dépense reste visible sans badge (validée, mais carried_from_recap_id != null signifie "héritée").

  **Conventions / leçons** :
  - **Filtre canonique unique pour 3 états** : `.is('carried_from_recap_id', null)` couvre les 3 cas (transaction pure / état A / état B) sans branche conditionnelle. Plus simple et plus robuste que `.eq('is_carried_over', false)` + `.is('carried_from_recap_id', null)` combinés. Le champ `carried_from_recap_id` est la source de vérité de la provenance "héritée".
  - **Mémoire bidirectionnelle préservée** : la règle Sprint 15 V3 ("NE PAS NULL `carried_from_recap_id` à la validation") devient maintenant le pivot du filtre canonique. Le champ est utilisé pour 2 raisons orthogonales : (1) le retour arrière `validate=false` (Sprint 15 V3), (2) l'exclusion du calcul current-month (Part 35).
  - **Le mécanisme `carryover_spent_amount` est orthogonal** : ce champ représente la "dette financière abstraite" persistée sur `estimated_budgets` lors du finalize (delta non-absorbé entre estimated et actually spent). Il continue d'être lu et additionné dans les calculs (cf. [lib/api/finance/expenses-progress.ts:135](../../lib/api/finance/expenses-progress.ts) `actualSpent + carryoverSpent`). Pas touché par le sprint.
  - **Décision business "appartient au mois d'origine"** consignée explicitement dans operational-rules.md §5 (rule ❌ raffinée 2026-05-27). Le sprint a clarifié une intention de design Sprint 15 V3 qui n'avait pas été testée contre le ressenti user en condition réelle d'usage.
  - **Régression-guard explicite avec commentaire delta** : le nouveau cas test "Part 35 regression-guard" indique en commentaire les valeurs attendues SANS le fix (210/390/180), pour qu'une future tentative de "simplification" qui re-introduirait `.eq('is_carried_over', false)` casse immédiatement le test avec un message exploitable.

  **Files livrés** :
  - **Nouveaux** (1) : `.claude/history/roadmap-detailed-35-carryover-validated-exclude-from-rav.md` (ce fichier).
  - **Modifiés** (16) : `CLAUDE.md` (§5.5 tests 795/227→796/228, §11 État global + 35 parts + Part 35 link), `.claude/conventions/operational-rules.md` (§5 Carry-over UI réécrit), `lib/finance/financial-data.ts`, `lib/finance/income-compensation.ts`, `lib/finance/budget-savings-detail.ts`, `lib/api/finance/expenses-progress.ts`, `lib/api/finance/income-progress.ts`, `lib/api/finance/budgets-estimated.ts`, `lib/api/finance/expenses-preview-breakdown.ts`, `lib/api/finance/expenses-add-with-logic.ts`, `lib/api/finance/expenses-real.ts`, `lib/recap/load-summary.ts`, `lib/finance/__tests__/financial-data.test.ts`, `lib/finance/__tests__/financial-data-bug-repro.test.ts`, `lib/api/finance/__tests__/expenses-add-with-logic.test.ts` (mock `.is/.not` chain), `lib/recap/__tests__/load-summary.test.ts` (mock `is` builder), `components/dashboard/TransactionListItem.tsx` (helper + badge label), `components/dashboard/__tests__/TransactionListItem.test.tsx` (+1 cas Part 35).

  **Verification** :
  - `pnpm typecheck` exit 0.
  - `pnpm lint:check` exit 0.
  - `pnpm test:run` exit 0 (795 cas non-gated).
  - `SUPABASE_FINANCE_TESTS=1 pnpm test:run` exit 0 sur lib/finance/**tests**/financial-data.test.ts (228 cas gated dont +1 Part 35).
  - Test manuel : seed dev avec carry-overs en mois courant, long-press "Valider" sur une dépense reportée → solde baisse, RAV inchangé, "dépensé sur ce budget" inchangé, pas de déficit. Long-press "Dévalider" → solde re-monté, RAV toujours intact, badge "Mois précédent" réapparaît.

  **À ne pas réintroduire** (cf. [operational-rules.md §5](../conventions/operational-rules.md)) :
  - `.eq('is_carried_over', false)` seul comme filtre carry-over pour les calculs current-month → insuffisant (laisse passer état B).
  - NULL `carried_from_recap_id` à la validation (`p_validate=true`) → casserait à la fois le retour arrière bidirectionnel ET le filtre canonique Part 35.
  - Filtrer carry-overs sur les GET de listing UI → casse l'affichage UX (l'utilisateur ne pourrait plus valider/supprimer).
