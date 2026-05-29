# Part 39 — Exceptional-Expense-Piggy-Funding (financer une dépense exceptionnelle avec la tirelire)

> Sprint livré 2026-05-29 sur branche `dev`. La modal d'ajout d'une **dépense exceptionnelle**
> (hors budget) propose désormais un toggle **« Utiliser ma tirelire »** : l'utilisateur prélève
> un montant dans sa tirelire (plafonné à `min(solde, montant)`), le reste est porté par son
> « propre argent ». **Seule la part propre argent pèse sur le RAV** ; la part tirelire ne fait
> que baisser les économies. Supprimer la dépense **recrédite la tirelire**. Marche en solo ET
> en groupe (le contexte détermine quelle tirelire — perso vs groupe). Inclut un fix d'un champ
> fantôme (`FinancialData.piggyBank` jamais peuplé) + un détail UX (vidage du `0` au focus).

## Contexte

Avant ce sprint, une dépense exceptionnelle était un simple INSERT dans `real_expenses`
(`is_exceptional=true`, `estimated_budget_id=NULL`) et son **montant entier** était soustrait au
RAV. Aucun moyen de puiser dans la tirelire pour la financer — alors que la tirelire (économies
mises de côté) est exactement le bas de laine qu'on voudrait mobiliser pour une dépense imprévue.

Découverte clé en explorant : ~90 % de l'infra existait déjà.

- `real_expenses.amount_from_piggy_bank` (colonne présente, déjà SELECTed partout).
- Table de traçabilité `expense_savings_sources` (`source_type='piggy'`, migration `20260531000000`).
- RPC `delete_expense_with_sources_refund` **recrédite déjà la tirelire** via le fallback legacy
  `amount_from_piggy_bank > 0` (non gardé par budget) → **réutilisé tel quel** pour le delete.
- `update_piggy_bank_amount` + pattern ensure-row (cf. `delete_carried_expense_to_piggy`).

Le travail réel : 1 RPC de création + 1 toggle UI + le routage du DELETE + le calcul RAV. Plus un
bug latent à corriger pour que la chaîne marche (cf. §Fix `piggyBank`).

## Décisions produit (AskUserQuestion 2026-05-29)

1. **Impact RAV = part propre argent uniquement.** Ex : tirelire 200 €, dépense exceptionnelle
   300 € dont 200 € tirelire ⇒ tirelire → 0 € et le RAV ne baisse que de **100 €** (le reste).
   Rejette « les 300 € baissent le RAV » (double-comptage : la tirelire baisse déjà `totalSavings`).
2. **Édition verrouillée.** Une dépense exceptionnelle financée par tirelire ne se modifie pas
   directement → on la supprime (tirelire recréditée auto) puis on la recrée. « Modifier » masqué
   dans le menu + guard 409 côté API (défense en profondeur). Rejette « modifiable librement »
   (réconciliation delta de la tirelire = surface de bug) et « date/libellé seulement ».

## Architecture

### RPC atomique de création — `add_exceptional_expense_with_piggy`

Migration [20260608000000_create_add_exceptional_expense_with_piggy_rpc.sql](../../supabase/migrations/20260608000000_create_add_exceptional_expense_with_piggy_rpc.sql).
Calquée sur `add_expense_with_breakdown` ([20260531010000](../../supabase/migrations/20260531010000_update_add_expense_rpcs_with_sources.sql)).
Signature `(p_amount, p_description, p_expense_date, p_amount_from_piggy_bank, p_profile_id?,
p_group_id?, p_created_by_profile_id?) → json`. En une seule tx :

- garde-fous : `amount > 0`, XOR contexte (`profile_id` XOR `group_id`), `0 ≤ piggy ≤ amount`.
- ensure-row tirelire (inline `INSERT … EXCEPTION WHEN unique_violation` pour compte neuf).
- débit tirelire via `update_piggy_bank_amount(-piggy)` (RAISE si solde insuffisant → rollback total).
- INSERT `real_expenses` : `is_exceptional=true`, `estimated_budget_id=NULL`, `amount`,
  `amount_from_piggy_bank=P`, `amount_from_budget_savings=0`, `amount_from_budget=amount−P`
  (= part propre argent), `created_by_profile_id`.
- INSERT trace `expense_savings_sources` (`source_type='piggy'`, `amount=P`).

Helper TS `addExceptionalExpenseWithPiggy` dans [lib/finance/expenses.ts](../../lib/finance/expenses.ts)
(convention C3 : import direct du submodule, pas exposé au barrel).

### Création — `lib/api/finance/expenses-add-with-logic.ts`

Branche exceptionnelle (`!estimated_budget_id`) dédoublée : si `amount_from_piggy_bank > 0` →
helper RPC + re-fetch de la ligne (mirror branche budgétée) ; sinon → INSERT direct historique
inchangé. Body schema [addExpenseWithLogicBodySchema](../../lib/schemas/expense.ts) étendu d'un
`amount_from_piggy_bank: nonNegativeMoneySchema.optional()`. `CreateRealExpenseRequest`
([hooks/useRealExpenses.ts](../../hooks/useRealExpenses.ts)) idem.

### Suppression — réutilisation de l'existant

[expenses-real.ts](../../lib/api/finance/expenses-real.ts) DELETE : le routage vers
`deleteExpenseWithSourcesRefund` est élargi — `hasPiggyRefund = amount_from_piggy_bank > 0` route
aussi les exceptionnelles financées par tirelire vers la RPC de refund (qui recrédite la tirelire
via la trace `piggy`). Une exceptionnelle SANS tirelire reste sur le DELETE direct. **Aucune
nouvelle RPC de delete** — l'existante gère le cas budget=NULL.

### Verrou édition

PUT `expenses-real.ts` : le `protectedCheck` lit `is_exceptional, amount_from_piggy_bank` et
renvoie 409 `cannot-edit-piggy-funded-exceptional` si financée par tirelire. UI
[TransactionListItem.tsx](../../components/dashboard/TransactionListItem.tsx) : flag
`isPiggyFundedExceptional` → spread conditionnel retire « Modifier » (miroir carry-over).

### Calcul RAV — `lib/finance/financial-data.ts`

`exceptionalExpenses` somme désormais `amount − (amount_from_piggy_bank ?? 0)` (part propre argent).
Backward-compatible : les exceptionnelles historiques ont `amount_from_piggy_bank=NULL → 0` ⇒
`amount − 0 = amount` (inchangé). `totalSavings` continue d'inclure le solde tirelire → cohérence
comptable globale (la dépense de 300 € se traduit par −200 € économies et −100 € RAV).

### Fix champ fantôme `FinancialData.piggyBank`

Bug latent surfacé au test utilisateur (le toggle n'apparaissait jamais, même groupe avec tirelire
pleine) : `piggyBank` était **déclaré** sur le type `FinancialData` (commentaire « utilisé par
useExpenseBreakdown ») mais **jamais peuplé** par `_loadFinancialData` — seulement utilisé en
interne pour `totalSavings`. Donc `financialData.piggyBank` était toujours `undefined` →
`piggyBankBalance = 0` → section masquée partout. Fix : le retour de `_loadFinancialData` expose
maintenant `piggyBank: piggyBankData?.amount ?? 0`. Les 3 golden objects gated
([financial-data.test.ts](../../lib/finance/__tests__/financial-data.test.ts)) mis à jour
(`piggyBank` = 50 profile / 100 group / 0 empty). Bénéficie aussi à `useExpenseBreakdown`.

### UI modal + aperçu

[AddTransactionModal.tsx](../../components/dashboard/AddTransactionModal.tsx) : toggle « Utiliser
ma tirelire » visible si `expense && isExceptional && piggyBankBalance > 0` (via
`useFinancialData(context)`). Toggle on → `<DecimalFormInput>` plafonné `min(solde, montant)`,
libellé « Reste à votre charge ». Guard submit `piggyToSend ≤ solde` (évite un 500). État reset au
changement type/kind. [RemainingToLivePreview.tsx](../../components/dashboard/RemainingToLivePreview.tsx)
reçoit `fromPiggyBank` → impact RAV = `−(amount − fromPiggyBank)` + ligne tirelire affichée.
[TransactionListItem.tsx](../../components/dashboard/TransactionListItem.tsx) : panel de
confirmation delete montre tirelire recréditée + RAV recrédité (part propre argent) ; le badge 🪙
existant rend gratuitement l'indicateur de financement. `piggyBankAmount` câblé depuis
[TransactionTabsComponent.tsx](../../components/dashboard/TransactionTabsComponent.tsx) (corrige
aussi le même trou pour les budgétées-avec-tirelire).

### Sémantique tirelire perso vs groupe

Le toggle lit la tirelire **du contexte courant** : une dépense exceptionnelle **de groupe** puise
dans la **tirelire du groupe** (row `piggy_bank` par `group_id`), une dépense **perso** dans la
tirelire perso. Le delete recrédite la même tirelire. Pas de cross perso↔groupe (cohérent avec le
XOR contexte des RPCs et la spec d'origine).

## Follow-up UX — vidage du `0` au focus (`DecimalFormInput`)

Détail livré dans le même sprint (commit séparé `fix(ui)`). Le composant partagé
[DecimalFormInput.tsx](../../components/ui/DecimalFormInput.tsx) (tous les champs montant : dépense
/ revenu / budget / projet + part tirelire) vide le champ au focus quand il vaut exactement `0`
(la frappe part propre, fini « 01999 ») et restaure `0` au blur si laissé vide. Valeurs non-nulles
(mode édition) préservées. 4 tests ajoutés. Hors-scope : le champ « Salaire » (Settings) est un
input natif `type="number"` (composant différent) ; « Durée (mois) » d'un projet n'est pas un
montant et se vidait déjà à 0.

## ❌ Ne pas réintroduire

- ❌ Sommer le `amount` plein des dépenses exceptionnelles dans `exceptionalExpenses`
  (`financial-data.ts`) — soustraire `amount_from_piggy_bank` (part propre argent uniquement).
- ❌ Oublier de peupler `FinancialData.piggyBank` dans `_loadFinancialData` (champ consommé par le
  modal + `useExpenseBreakdown`). Plus généralement : un champ optionnel de `FinancialData`
  consommé côté UI doit être réellement peuplé, pas seulement déclaré sur le type.
- ❌ Créer une RPC de delete dédiée pour les exceptionnelles piggy — `delete_expense_with_sources_refund`
  gère déjà le cas (trace `piggy` + fallback legacy, budget NULL toléré).
- ❌ Rendre éditable une exceptionnelle financée par tirelire (réconciliation delta tirelire =
  surface de bug) — garder le verrou 409 + « Modifier » masqué.
- ❌ Permettre de financer une dépense de groupe depuis la tirelire perso (ou inverse) — contexte-scopé.

## Notes DB / déploiement

`supabase db push` était cassé (auth SASL `SUPABASE_DB_PASSWORD` échoue, SQLSTATE 28P01) → la
migration `20260608000000` a été appliquée en **prod + dev** via `node scripts/apply-sql.mjs`
(Management API, `SUPABASE_ACCESS_TOKEN`). ⚠️ Non enregistrée dans `schema_migrations` (apply-sql
ne track pas) → à réparer une fois le mot de passe DB corrigé (`migration repair --status applied
20260608000000` sur les 2 projets, ou `db push` ré-applique l'idempotent `CREATE OR REPLACE`).
Suivi dans [prompt-housekeeping/maintenance.md](../../prompt-housekeeping/maintenance.md) Tâche 4.

## Invariants (post-sprint)

- `EXPECTED_RPCS` **28 → 29** (`add_exceptional_expense_with_piggy` ajouté à
  [check-rpcs.mjs](../../scripts/check-rpcs.mjs)).
- Functions DB versionnées **43/43 → 44/44** (`pnpm db:audit-functions` OK).
- Tests non-gated **823 → 846** (+12 schémas, +5 RTL modal piggy, +3 RTL list, +4 DecimalFormInput,
  −1 ajustement) ; gated **234 → 242** (+8 cas RPC `add-exceptional-expense-with-piggy.test.ts`).
- `pnpm typecheck` / `lint:check` 0/0 / `db:check-rpcs` 29 / `db:check-types-fresh` / `db:check-drift`
  / `db:audit-functions` / `db:audit-objects` : verts.

## Tests

- **Gated** `SUPABASE_RPC_CONCURRENCY_TESTS=1` :
  [add-exceptional-expense-with-piggy.test.ts](../../lib/finance/__tests__/add-exceptional-expense-with-piggy.test.ts)
  (8 cas : débit partiel `P<A` / couverture totale `P=A` / groupe / overdraft → rollback atomique +
  0 ligne / compte neuf ensure-row / XOR / round-trip create→delete-refund rendant la tirelire / 30
  créations concurrentes). **Écrit mais pas encore exécuté** (besoin keys DB) — cf. maintenance Tâche 4.C.
- **Gated** `SUPABASE_FINANCE_TESTS=1` : goldens `financial-data.test.ts` mis à jour (`piggyBank`).
- **Non-gated** : schémas (`expense-add` +6, `transactions` +6), RTL
  (`AddTransactionModal.piggy` 5 : section visible/masquée, input révélé, submit avec/ sans part ;
  `TransactionListItem` +3 : « Modifier » masqué piggy-funded / conservé exceptionnelle simple /
  panel delete tirelire+RAV), `DecimalFormInput` +4 (clear-on-focus / restore-on-blur).
