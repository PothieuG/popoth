# Roadmap détaillé — Part 16 : Expense-Preview-Posé-Layout + Preserve-Caps-Edit-Allocation

> Chronologie des sprints livrés à partir de 2026-05-21 (suite de [roadmap-detailed-15-skeleton-refetch-loaders.md](roadmap-detailed-15-skeleton-refetch-loaders.md)). Split préemptif pour rester sous le cap 38k chars/fichier.

## Sprints

- ✅ **Sprint Expense-Preview-Posé-Layout + Preserve-Caps-Edit-Allocation** (livré 2026-05-21, déclenché par "j'aimerais que le résumé des impacts sur les budgets/reste à vivre/economies lorsqu'on crée ou modifie ou crée une depense budgetée, soient plus facile à lire. Je préfererais une vision plus simpliste, un peu comme c'est le cas avec les dépenses exceptionnelles, sous forme 'posé' avec le résultat en bas") puis itéré sur bug report "j'ai un budget de 200€ et des economie à 300€ dessus. J'ai crée deux dépenses pour ce budget: une de 123€ et une de 275€. Quand je modifie la dépense 123€ pour mettre 130€, je devrais avoir Impact: economie -25€, budget -105€ — preserver les économies déjà revendiquées par la dépense").

  **(1) Refonte UI [components/dashboard/ExpenseBreakdownPreview.tsx](../../components/dashboard/ExpenseBreakdownPreview.tsx)** : passage du layout 3-sections (sources / impact détaillé before→after / summary emoji) vers le pattern "posé" 2-sections : **Impact de la dépense** (sources débitées « posé ») + **Après opération** (recap soldes finaux). Bordure outer plate `border-blue-200 bg-blue-50/50 p-4` (drop gradient). Choix layout validé via `AskUserQuestion` 3-options preview ASCII (A pose+total / B ligne-par-source / C variante A sans total débit) — user choisit **C + masquage des lignes à 0** (hide Tirelire/Économies si débit=0, Budget destination toujours affiché car contexte de la dépense). Le composant continue de se brancher sur `useFinancialData(context)` + `useProgressData(context)` pour le calcul RAV via delta de déficit budgétaire.

  **(2) Code couleur par entité + signe sur montant** (specs UX user 2026-05-21) :
  - Labels colorés : `Budget` orange (text-orange-600), `Économies` violet (text-violet-600), `Tirelire` rose (text-pink-600 — choix `AskUserQuestion` "Rose" recommandé), `Reste à vivre` bleu (text-blue-600).
  - Noms de budgets en **bold** à l'intérieur des « » (`font-bold`).
  - Impact : montants négatifs en rouge (text-red-600) avec `-` natif Intl, positifs en vert (text-green-600) avec `+` explicite préfixé (case "credit/refund" possible quand l'allocation API recompute moins de sources qu'existant).
  - Recap "Après opération" : **tous les chiffres en noir** (text-gray-900) — UX user "je ne veux des couleurs sur les chiffres que dans la section impact". Drop du green/red et du red-on-overflow. Budget recap conserve le code couleur du label (orange) mais le ratio `dépensé/estimé` est noir.

  **(3) Format Budget recap `dépensé/estimé`** (validé `AskUserQuestion` Q1 : "98/200 = 98€ dépensés sur 200€") — matches la convention planner/dropdown. `${formatAmountCompact(spent)}/${formatAmountCompact(estimated)}`, strip `,00` pour whole-euros via le helper miroir `TransactionListItem` (regex `/[,.]\d{2}(\s*€)/, '$1'`). Si overflow (spent > estimated), affiché tel quel (e.g., `250€/200€`) sans color cue — le dépassement est visible directement dans le nombre.

  **(4) Hide preview en EDIT quand montant inchangé** (UX user "je veux ne pas charger/calculer le recap si je ne touche à rien"). Gate parent dans [components/dashboard/EditTransactionModal.tsx:418](../../components/dashboard/EditTransactionModal.tsx) `Math.round(previewSafe * 100) !== Math.round(transaction.amount * 100)` (comparaison en cents pour éviter les imprécisions flottantes). Le composant n'étant pas monté, `useQuery` ne fire pas → 0 fetch API à l'ouverture, ré-apparait dès la 1ère frappe sur le champ montant. En ADD mode (no transaction), preview affichée dès `previewSafe > 0 && budgetId`.

  **(5) Fix dropdown `398€/200€`** : bug dans [EditTransactionModal.calculateRealSpentAmount](../../components/dashboard/EditTransactionModal.tsx:101) qui sommait `expense.amount` (total dépense) au lieu de `expense.amount_from_budget` (portion réellement chargée au pool budget). Pour le scénario user (budget 200€ + 300€ économies, 2 dépenses 123+275 dont 300 absorbé par savings + 98 par budget), le dropdown affichait `398/200`. Fix : mirror `AddTransactionModal.calculateRealSpentAmount` (sum `amount_from_budget` avec fallback `amount` pour legacy nulls).

  **(6) Algorithme « preserve existing caps » en EDIT (server + preview)** — refonte côté backend après 2 itérations. **Première itération** : drop le `budgetSpentBefore -= existingExpense.amount_from_budget` dans la route preview-breakdown (qui virtuellement faisait "comme si la dépense n'existait pas" → calculateBreakdown obtenait un `budgetRemaining` trop grand et mettait tout sur le budget). Ce fix aligne preview ↔ server PUT pour la majorité des cas. **Deuxième itération (après user bug A 123→5 stocké `{budget=5, savings=0}` au lieu de `{budget=0, savings=5}`)** : introduction d'un nouvel algorithme côté `applyAllocation`.

  Nouveau paramètre optionnel `existingExpense?: ExpenseWithBreakdown | null` sur [lib/expense-allocation.ts::applyAllocation](../../lib/expense-allocation.ts). Quand fourni (mode EDIT), bascule sur :

  ```
  remaining = amount
  nP = min(remaining, existing.amount_from_piggy_bank)
  remaining -= nP
  nS = min(remaining, existing.amount_from_budget_savings)
  remaining -= nS
  nB = remaining  // absorbe le reste, incl. déficit éventuel
  ```

  Les caps savings/piggy stockés sur la dépense sont des **CEILINGS** pour la nouvelle allocation, budget absorbe le reste (incl. déficit > estimated si user augmente fort). Sans `existingExpense` (mode ADD), P4-strict standard inchangé.

  Wiring :
  - [lib/api/finance/expenses-real.ts:312](../../lib/api/finance/expenses-real.ts) PUT handler passe `oldExpense` au 4e arg de `applyAllocation`.
  - [lib/api/finance/expenses-preview-breakdown.ts](../../lib/api/finance/expenses-preview-breakdown.ts) duplique l'algo inline (la route ne peut pas importer la version server `applyAllocation` qui fait des UPDATE — il faut juste calculer, pas écrire).
  - `budgetSpentAfter` corrigé dans les deux modules : `budgetSpentBefore - (existingExpense?.amount_from_budget ?? 0) + fromBudget`. Le `budgetSpentBefore` lu via SELECT inclut la valeur old (real_expenses pas encore UPDATE), donc on soustrait la contribution existante avant d'ajouter la nouvelle.

  Vérification des cas user (existing eS=25, eB=98) :
  - A 123→130 (INCREASE) : nS=min(130,25)=25, nB=105. Recap : Économies 0€, Budget 105/200. ✓
  - A 123→5 (DECREASE) : nS=min(5,25)=5, nB=0. Recap : Économies 20€, Budget 0/200. ✓
  - A 123→30 (DECREASE) : nS=min(30,25)=25, nB=5. Recap : Économies 0€, Budget 5/200. ✓
  - A 123→1000 (deficit forcé) : nS=25, nB=975. Recap : Économies 0€, Budget 975/200 (overflow visible). ✓

  **(7) Composant simplifié post-itération** : l'override `existingExpense` côté composant (introduit en première itération pour stabiliser le display en unchanged-edit) devient **dead code** après la migration de l'algorithme au serveur (le serveur retourne maintenant directement les bonnes valeurs). Drop du prop `existingExpense?` + du bloc override. `ExpenseBreakdownPreview` n'a plus que les props originaux (`amount`, `budgetId`, `context`, `expenseId`, `useSavings`). Les tests RTL des consumers (AddTransactionModal, EditTransactionModal, a11y-audit) qui mockent déjà ce composant à null restent intacts.

  **Vérification end-to-end** :
  - `pnpm typecheck` exit 0
  - `pnpm lint:check` 0 errors / 0 warnings
  - `pnpm format:check` exit 0
  - `pnpm test:run` **515 passed / 98 skipped** baseline stable (aucun test direct sur preview-breakdown route, les tests gated finance n'exercent pas le edit-flow avec savings cap preservation — gap à combler dans un futur sprint)

  **Files livrés** :
  - **Modifiés UI** (2) : `components/dashboard/ExpenseBreakdownPreview.tsx` (refonte complète layout + couleurs + drop override), `components/dashboard/EditTransactionModal.tsx` (dropdown fix + gate amount-changed).
  - **Modifiés backend** (3) : `lib/expense-allocation.ts` (param `existingExpense?` + algo EDIT preserve-cap), `lib/api/finance/expenses-real.ts` (PUT wire oldExpense), `lib/api/finance/expenses-preview-breakdown.ts` (algo EDIT mirroir + budgetSpentAfter correct).
  - **Modifiés conventions** (4) : `CLAUDE.md` (§11 index), `.claude/conventions/operational-rules-ui-modals.md` (+2 règles ❌), `.claude/conventions/operational-rules.md` (+1 sous-section §5 + 1 row §6 chronologie), `.claude/guardrails/size-policy.md` (inventaire).

  **Trade-off / leçons apprises** :
  - L'algorithme « preserve existing caps » diverge légèrement de l'algorithme « ADD P4-strict » : un INCREASE avec savings additionnelle disponible **ne cascade pas** vers les nouvelles savings (cap strict à l'existing). Si user veut bénéficier de savings additionnelle sur edit increase, il devrait supprimer + recréer la dépense (ou un futur toggle `expand_savings_cap` opt-in côté EditTransactionModal). Choix : pas de bridage UI maintenant, le cas est rare et l'utilisateur peut s'en sortir via recréation.
  - Le diagnostic du bug RAV-stale-cache (Sprint Enrich-Delete-Confirmation 2026-05-21) + ce sprint (edit-flow allocation divergente) ont un pattern commun : "feature marche au poil" disait l'user, mais le math affiché était subtilement faux à cause d'un layer de divergence preview↔storage. Leçon installée : pour chaque feature où le frontend affiche un "preview de ce que le serveur fera", il faut une **suite de tests gated** qui vérifie l'égalité byte-identique preview↔storage post-save. Sprint dédié `Add-Preview-Storage-Parity-Tests` à programmer.
  - L'itération a tiré 4 `AskUserQuestion` (layout choice, Tirelire color, Budget format, Edit-amount-changed semantic) — utile pour les UX-sensitive choices, à éviter pour les conventions back-end où la lecture du code suffit. Total ~10 round-trips conversation, 3 commits successifs (UI refonte → fix dropdown + UX colors → preserve-caps algo + hide-preview).
  - Le `pointer-events: auto` (Sprint Fix-Dropdown-PointerEvents-Auto 2026-05-21) + cet algorithme EDIT sont des cas où la lecture statique du code seul ne suffisait pas à diagnostiquer. La conversation interactive avec contre-exemples concrets a été essentielle.

  **Pattern à retenir** :
  - Pour tout aperçu côté UI d'une opération à effet de bord (ajout/modification/suppression d'une transaction financière), **l'API preview DOIT être bit-identique à ce que le mutation va stocker**. Si l'API preview fait un calcul à part, ça devient un canard boîteux : l'user croit voir le post-save, sauve, et l'état stocké diffère. Tester explicitement preview-vs-storage.
  - Pour toute édition d'une dépense budgétée, les caps `amount_from_piggy_bank` et `amount_from_budget_savings` stockés sur la dépense sont des **CEILINGS** pour la nouvelle allocation (pas des hints à recalculer fresh). Le user mental model : "j'ai utilisé X€ d'économies pour cette dépense, je veux que ça reste X€ d'économies même si je change le montant". Pattern miroir entre `applyAllocation(amount, budgetId, contextFilter, existingExpense)` et la duplication intentionnelle dans `expenses-preview-breakdown.ts` (chemin route route séparé, import server-only pas trivial à factoriser).
  - Pour les modals d'édition, gate l'aperçu sur un **changement effectif** réduit le bruit visuel + supprime le coût réseau de la preview à l'ouverture. Pattern : `if (Math.round(newValue * 100) !== Math.round(existingValue * 100)) <Preview ...>`. Comparaison en cents pour robustness aux décimaux flottants.
