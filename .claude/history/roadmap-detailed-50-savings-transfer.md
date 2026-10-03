# Part 50 — Transfert d'économies (2026-10-03)

> 1 sprint. Demande de l'utilisateur : un 3e type dans le dialogue d'ajout,
> « Transfert d'économies ». Écran suivant : **Envoi** ou **Réception**, puis
> **juste le montant**. « Seulement impacter le solde disponible et RIEN
> D'AUTRE » : on enlève d'autant à l'envoi, on ajoute à la réception. Le
> montant ne dépasse jamais le total des économies disponibles.

## 1. Décisions produit

| Question                     | Réponse                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Ce qui bouge                 | **Uniquement** `bank_balances.balance` : envoi −montant, réception +montant                    |
| Ce qui ne bouge pas          | Économies des budgets, tirelire, reste à vivre, budgets, listes de transactions, récap         |
| Plafond                      | Total des économies = budgets + tirelire (`FinancialData.totalSavings`, carte « Économies »)   |
| Plafond pour les deux sens ? | Oui, comme demandé (envoi ET réception). Pas de plafond sur le solde : il peut devenir négatif |
| Champs                       | Montant seul : ni description, ni date, ni rattachement                                        |

Choix faits sans question (signalés à l'utilisateur) :

- **Aucune trace dans la liste des transactions** : la consigne « rien d'autre »
  l'exclut, et une ligne `real_expenses` / `real_income_entries` entrerait dans
  le RAV, le récap et la répartition. Corriger une erreur = transfert inverse
  (ou édition du solde dans les paramètres). Pas de migration.
- **Groupe** : ouvert à tout membre, comme l'ajout d'une transaction ou son
  appui long (l'édition directe du solde reste réservée au créateur).
- **Absent du wizard récap** « Compléter le mois » : il ne touche pas au mois
  recapé.
- Carte **désactivée** (avec « Aucune économie disponible ») quand le total est
  nul, sur le modèle de « Réception du salaire ».

## 2. Serveur

- Règles pures partagées client/serveur :
  [lib/finance/savings-transfer.ts](../../lib/finance/savings-transfer.ts) —
  `savingsTransferDelta`, `savingsTransferMax` (jamais < 0),
  `exceedsSavingsTransferMax` (comparaison **au centime** : `0,1 + 0,2` ne doit
  pas refuser 0,30 €, et une tolérance fixe laisserait passer un centime de
  trop).
- Route `POST /api/finance/savings-transfer`
  ([lib/api/finance/savings-transfer.ts](../../lib/api/finance/savings-transfer.ts),
  `withAuthAndGroup`) : body `{ context, direction: send|receive, amount }`
  (`savingsTransferBodySchema`). Relit le total en base
  (`estimated_budgets.cumulated_savings` + `piggy_bank.amount`, en parallèle),
  409 `savings-transfer-exceeds-savings` au-delà, sinon `ensureBankBalanceRow`
  puis `updateBankBalance` (RPC `update_bank_balance`, déjà pinnée). Réponse
  `{ data: { balance } }`. 400 contexte groupe sans groupe.
- Lecture puis écriture sans verrou, assumé : le transfert ne modifie pas les
  économies, le plafond est un garde-fou, pas un invariant à protéger.
- Aucune RPC, aucune table, aucune migration : `EXPECTED_RPCS` reste 31.
  Entrée ajoutée au registre OpenAPI.

## 3. Client

- [hooks/useSavingsTransfer.ts](../../hooks/useSavingsTransfer.ts) :
  `transfer({ direction, amount })` → `{ ok, balance } | { ok: false, error }`.
  Succès : `applyBankBalanceToCache` (comme l'appui long), **pas**
  `invalidateFinancialRefreshes` — rien d'autre n'a changé, relancer les 11
  keys referait ~12 appels.
- [SavingsTransferSteps.tsx](../../components/dashboard/SavingsTransferSteps.tsx) :
  `SavingsTransferDirectionStep` (2 cartes violettes, charte économies) et
  `SavingsTransferAmountStep`, qui porte **son propre** `useForm` (Pattern D :
  `makeSavingsTransferFormSchema({ totalSavings })`) et le hook — le formulaire
  du dialogue (description, date, rattachement) ne s'y prête pas, et les tests
  du dialogue tournent sans `QueryClientProvider`. Aperçu « Solde disponible
  A → B », masqué pour un montant refusé.
- [AddTransactionModal.tsx](../../components/dashboard/AddTransactionModal.tsx) :
  étapes `transfer-direction` → `transfer-amount`, titre « Transfert
  d'économies », retour vers le sens puis le type. `transferBusy` (remonté par
  `onBusyChange`) bloque retour et fermeture pendant l'envoi. Fermeture directe
  au succès, sans `onTransactionAdded` (le cache est déjà à jour).
- Vérifié en navigateur (Chromium mobile 375 px, page de prévisualisation
  temporaire non commitée) : aucun débordement horizontal. Retouches issues des
  captures : espace insécable avant `?` / `:`, consigne raccourcie (« Dans quel
  sens va l'argent ? » — la coupure tombait sur « revient-il »), projection du
  solde cachée au-delà du plafond.

## 4. Tests (+41 non-gated : 1255 → 1296)

- `lib/finance/__tests__/savings-transfer.test.ts` (+8) : sens, plafond ≥ 0,
  exactement le total, un centime de trop, `0,1 + 0,2`.
- `lib/schemas/__tests__/savings.test.ts` (+6) : body (sens inconnu, 0, négatif,
  3 décimales) et formulaire (saisie décimale, message sur `amount`).
- `lib/api/finance/__tests__/savings-transfer.test.ts` (+13) : delta envoyé à
  `updateBankBalance`, **aucune autre écriture**, filtres groupe, 409 sans
  écriture (les 2 sens), 400 / 500 (lecture, préparation, écriture).
- `hooks/__tests__/useSavingsTransfer.test.tsx` (+2) : corps du POST, solde
  patché, RAV et économies du cache intacts, 0 invalidation ; erreur sans
  toucher au cache.
- `AddTransactionModal.savings-transfer.test.tsx` (+12) : carte présente /
  désactivée / absente du récap, parcours envoi et réception (contexte groupe),
  plafond côté formulaire et côté serveur, retour, axe sur les 2 étapes.

## 5. Docs

`CLAUDE.md` §5.5 (tests 1255 → 1296, routes 47 → 48) + §11 (Part 50, financé
par un raccourci de libellés). `operational-rules.md` +1 section ❌.
`structure-repo.md` +lignes (financées par compression). `sprint-chronology-part-3.md`
+1 ligne.
