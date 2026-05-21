# Roadmap détaillé — Part 17 : Delete-Header-And-Income-Polish

> Chronologie des sprints livrés à partir de 2026-05-22 (suite de [roadmap-detailed-16-expense-preview-pose-and-preserve-caps.md](roadmap-detailed-16-expense-preview-pose-and-preserve-caps.md)). Split préemptif pour rester sous le cap 38k chars/fichier.

## Sprints

- ✅ **Sprint Delete-Header-And-Income-Polish** (livré 2026-05-22, déclenché par 4 demandes user en une passe : "quand je veux supprimer un revenu estimé, dans l'encart j'aimerais une petite phrase qui dit de combien mon revenu estimé sera modifié" + "Je n'ai pas d'encart de recap quand je modifie un revenu ajouté (qu'il soit exceptionnel ou non), crée en un" + "quand on supprime un revenu, supprime la phrase 'Revenu lié à 'xxx'. Sois plus concis. Utilise un code couleur si tu parles du reste à vivre" + "dans toutes les modals de suppression, j'aimerais qu'il soit marqué quelque part (je pense en haut de l'encart) un truc disant que c'est ce à quoi ça va ressembler.")

  **(1) Header "Après suppression :" obligatoire dans toutes les modals de suppression** : wrap des `details` de `<ConfirmationDialog>` avec un `<p className="text-sm font-medium text-gray-700">Après suppression :</p>` au-dessus du panel/phrase. Le user voyait l'encart mais ne savait pas ce qu'il représentait. Implémenté dans :
  - [components/dashboard/TransactionListItem.tsx::buildDeleteDetails](../../components/dashboard/TransactionListItem.tsx) — wrapper `<div className="space-y-1.5 text-left">` avec header + inner content (panel ou phrase fallback selon branche).
  - [components/dashboard/PlanningDrawer.tsx](../../components/dashboard/PlanningDrawer.tsx) — fonction inline `details={(() => { ... })()}` qui wrappe les phrases budget/revenu avec le header.

  **(2) Income concision dans la modal de suppression** ([components/dashboard/TransactionListItem.tsx::buildIncomeDeleteDetails](../../components/dashboard/TransactionListItem.tsx)) : drop du `sourceLine` qui rendait "Revenu lié à **'Salaire Mai'**." dans les 3 branches income (exceptional, regular-with-context, regular-without-context). User explicite "Sois plus concis". Les phrases fallback (pas-de-panel) gardent leur texte mais colorient "reste à vivre" en `text-blue-600 font-medium` (inline span dans la phrase) pour cohérence avec l'EntityLabel du panel.

  **(3) Preview recap en mode édition d'un revenu (ou dépense exceptionnelle)** ([components/dashboard/EditTransactionModal.tsx](../../components/dashboard/EditTransactionModal.tsx)) : avant ce sprint, `<EditTransactionModal>` ne rendait que `<ExpenseBreakdownPreview>` pour les dépenses budgétées. Pas d'aperçu pour income edits ni pour exceptional expense edits. Ajout d'un bloc `<RemainingToLivePreview>` gated sur `transactionType === 'income' || (transactionType === 'expense' && isOriginallyExceptional)` + `Math.round(previewSafe * 100) !== Math.round(transaction.amount * 100)` (changement effectif du montant). Pass `existingAmount={transaction.amount}` pour back-out la contribution déjà comptabilisée.

  **(4) `<RemainingToLivePreview>` étendu avec `existingAmount`** ([components/dashboard/RemainingToLivePreview.tsx](../../components/dashboard/RemainingToLivePreview.tsx)) :
  - Nouveau prop `existingAmount?: number` défault 0 (mode ADD inchangé).
  - Branche exceptionnelle : `netAmount = amount - existingAmount` (delta) avant calcul de l'impact. Pour ADD : netAmount = amount (existing=0). Pour EDIT : netAmount = delta réel.
  - Branche income régulière : `effectiveCurrentReceived = currentReceived - existingAmount` (back-out de la tx existante avant le compute du newTotalReceived). Tous les calculs aval (currentDifference, newDifference, additionalChange) utilisent l'effective au lieu du raw cumul.
  - Permet à `<EditTransactionModal>` de rendre la preview sans double-compter la transaction en cours d'édition.

  **(5) Recap phrase pour la suppression d'un revenu estimé** ([components/dashboard/PlanningDrawer.tsx::ConfirmationDialog](../../components/dashboard/PlanningDrawer.tsx)) :
  - Extension du state `deletingItem` avec `estimatedAmount: number` (était cumulatedSavings only pour le budget).
  - `handleRequestDelete` capture `item.estimated_amount` (presnent sur EstimatedBudget ET EstimatedIncome).
  - Pour `type === 'income' && estimatedAmount > 0` : phrase "Vos revenus estimés passeront de **{currentTotal}** à **{newTotal}**." avec les 2 amounts en `text-green-600 font-semibold` (entity color income). `newTotal = totalIncomesWithSalary - estimatedAmount`.
  - Pour `type === 'budget' && cumulatedSavings > 0` : phrase historique sur le transfert des économies (purple) conservée + header "Après suppression :" ajouté.

  **Tests** : 3 tests RTL `TransactionListItem.test.tsx` mis à jour pour matcher les nouveaux comportements :
  - `queryByText(/Salaire Mai/)` not.toBeInTheDocument() (sourceLine droppée).
  - `getByText('Après suppression :').toBeInTheDocument()` (header obligatoire).
  - `getByText('reste à vivre').toHaveClass('text-blue-600')` (lowercase span coloré dans la phrase fallback).

  **Files livrés** :
  - **Modifiés UI** (4) : `components/dashboard/RemainingToLivePreview.tsx` (existingAmount prop + math back-out), `components/dashboard/EditTransactionModal.tsx` (preview block income+exceptional-expense), `components/dashboard/TransactionListItem.tsx` (header + drop sourceLine + color RAV inline), `components/dashboard/PlanningDrawer.tsx` (estimatedAmount state + income recap phrase + header).
  - **Modifiés tests** (1) : `components/dashboard/__tests__/TransactionListItem.test.tsx` (3 assertions mises à jour).
  - **Modifiés conventions** (4) : `CLAUDE.md` §11, `.claude/conventions/operational-rules-ui-modals.md` (+1 règle ❌ header obligatoire + income concision), `.claude/conventions/operational-rules.md` (+1 row §6 chronologie), `.claude/guardrails/size-policy.md` (inventaire).

  **Vérification end-to-end** :
  - `pnpm typecheck` exit 0
  - `pnpm lint:check` 0 errors / 0 warnings
  - `pnpm format:check` exit 0
  - `pnpm test:run` **513 passed / 98 skipped** (baseline stable)

  **Trade-off / leçons apprises** :
  - Le `existingAmount` prop sur `<RemainingToLivePreview>` est un défault 0 pattern — backward compatible avec tous les call sites ADD existants (AddTransactionModal). Seul `EditTransactionModal` le passe explicitement. Pattern à généraliser : les composants de preview qui peuvent fonctionner en ADD ET EDIT doivent accepter un optional existingAmount/existingId pour back-out la contribution courante.
  - Le `queryByText('Reste à vivre')` (capital R) ne match pas `<span>reste à vivre</span>` (lowercase) — testing-library est case-sensitive par défaut. C'est utile pour distinguer le label EntityLabel (capital R via le `word` constant) du texte inline en phrase fallback (lowercase). Cela permet d'asserter l'absence du panel sans ambiguité.
  - Le format de la phrase income delete "Vos revenus estimés passeront de X à Y" privilégie la before/after explicite plutôt que "diminueront de Z" (delta-only). L'utilisateur veut savoir le nouvel état total, pas juste la variation. Pattern miroir possible pour le budget delete (à implémenter si user complain).

  **Pattern à retenir** :
  - Pour toute modal de confirmation qui passe `details` à `<ConfirmationDialog>`, prepend un header "Après suppression :" (ou équivalent contextuel) au-dessus du contenu pour clarifier ce qu'il représente. Le user mental model "qu'est-ce qui change" doit être annoncé en clair.
  - Pour les composants de preview RAV/financier qui supportent ADD et EDIT, ajouter un prop `existingAmount?: number` (default 0). En EDIT, l'appelant passe `transaction.amount` pour permettre le back-out. Sans ça, le préview double-compte la contribution courante.
  - Pour les références inline à "reste à vivre" / "économies" / "budget" dans les phrases (en dehors du panel), utiliser un `<span className="font-medium text-{entity-color}">` pour cohérence visuelle avec les EntityLabel des panels. Le visual feedback aide l'utilisateur à associer les concepts à leurs couleurs.
