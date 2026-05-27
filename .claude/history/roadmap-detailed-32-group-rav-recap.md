# Roadmap Detailed — Part 32 : Group-RAV-Recap

Sprint isolé hors PÉ (post-finalize PÉ-11) — recap par-membre du RAV dans les 4 modals de planification groupe (AddBudget/EditBudget/AddProject/EditProject), avec assouplissement de la validation côté groupe (« warning mais autoriser »).

---

- ✅ **Sprint Group-RAV-Recap** (livré 2026-05-27 sur `dev`).

  ### Contexte

  Côté groupe, la validation du budget reposait sur `groupSalaryTotal + totalIncomes` (somme brute des salaires) comme plafond — la modal projet utilisait déjà l'agrégat `groupMembersPersonalRavTotal` mais sans détail par membre. Aucun des deux affichages ne disait QUEL membre serait pénalisé par l'opération. Demande user : aligner la validation budget sur la même logique RAV que les projets ET, dans les deux modals, afficher pour CHAQUE membre son RAV courant → projeté avec mise en évidence rouge si projeté négatif. Sémantique validation retenue : "warning mais autoriser" (le bouton submit reste actif côté groupe ; le perso garde son refine strict). Portée : ajout ET édition.

  ### Architecture

  **Data flow** : `getGroupFinancialData(groupId)` calculait déjà toutes les pièces nécessaires par membre (salaires, budgets perso bulk-fetchés, contributions) — il "suffisait" d'exposer le détail au lieu de juste sommer en `groupMembersPersonalRavTotal`. Nouveau champ `meta.groupMembersRav: GroupMemberRavDetail[]` ajouté à `FinancialData`. Forward `group-dashboard/page.tsx` → `FinancialIndicators` → `PlanningDrawer` → 4 modals (mêmes props : `context`, `groupMembersRav`, `currentGroupTotal`, `strictRav={!isGroupContext}`).

  **Preview client** : pure (zéro RTT, pas de mutation, pas de nouvelle migration). Module utility [lib/finance/group-members-rav-preview.ts](../../lib/finance/group-members-rav-preview.ts) avec `computeGroupMembersRavPreview` + helper `computeProjectedGroupTotal`. Algorithme miroir de la RPC PG `calculate_group_contributions` (prorata salaire si sum > 0, split égal sinon). Composant réutilisable [components/dashboard/GroupMembersRavRecap.tsx](../../components/dashboard/GroupMembersRavRecap.tsx) (mobile-first, carte bleue, ligne par membre, `role="alert"` rouge si `willGoNegative`).

  **Schémas Zod** : factories paramétrées par un flag `strictRav?: boolean` (default `true`, contrat perso préservé). `false` côté groupe → omet le refine RAV (budget) ou le refine 1 RAV (projet, le refine 2 cohérence durée/target reste inconditionnel — orthogonal).

  ### Fix authoritative RAV (livré dans le même sprint, 2026-05-27)

  Première version livrée avec un `currentRav` calculé via formule simplifiée `max(0, salary - personalBudgets - contribution)` côté `_loadFinancialData` — drift visible côté UI (~30€) vs le RAV réel du dashboard perso de chaque membre. Cause : la formule ignorait `incomeCompensation`, `exceptionalIncomes`, `exceptionalExpenses` autres que la contribution mirror, et `budgetDeficits`.

  **Correctif** : remplacement de la formule simplifiée par un appel `getProfileFinancialData(memberId)` par membre en parallèle (`Promise.all`). Le `currentRav` exposé dans `meta.groupMembersRav[i]` est désormais strictement la valeur que voit le membre sur son dashboard perso. Bénéfice secondaire : chaque appel met à jour `bank_balances.current_remaining_to_live` du membre → fini les snapshots stale après une cascade trigger groupe (les snapshots des membres n'étaient sinon rafraîchis qu'à leur prochaine visite du dashboard perso). Coût perf : N appels parallèles supplémentaires par ouverture du group-dashboard (acceptable pour N ≤ 5, cas typique).

  **Utility en delta-math** : `projectedRav = currentRav - deltaContribution`. Mathématiquement exact (pas une approximation) parce que tous les autres termes du RAV restent constants quand on ajoute/modifie un budget ou projet groupe — seule la contribution mirror change (de exactement `deltaContribution`). `willGoNegative` calculé sur le projeté brut. `currentRav` et `projectedRav` exposés bruts (peuvent être négatifs) → cohérence stricte avec ce qui s'affiche sur le dashboard.

  **Type simplifié** : `GroupMemberRavDetail` réduit à `{ profileId, firstName, salary, currentRav }` (les champs `personalBudgets` et `contribution` deviennent inutiles, le RAV authoritatif les absorbe). `groupMembersPersonalRavTotal` reste calculé en `sum(max(0, currentRav))` — sémantique "capacité collective" préservée (utilisé comme plafond validation projets).

  ### Modules livrés

  **Backend / types** :
  - [lib/finance/types.ts](../../lib/finance/types.ts) — nouveau type `GroupMemberRavDetail` + champ optionnel `meta.groupMembersRav?: GroupMemberRavDetail[]`.
  - [lib/finance/financial-data.ts](../../lib/finance/financial-data.ts) — refactor du bloc group (lignes ~290-330) : Promise.all sur `getProfileFinancialData(memberId)` + tri stable firstName + agrégat `groupMembersPersonalRavTotal = sum(max(0, currentRav))`.
  - [lib/finance/index.ts](../../lib/finance/index.ts) — re-export du type `GroupMemberRavDetail`.

  **Utility** :
  - [lib/finance/group-members-rav-preview.ts](../../lib/finance/group-members-rav-preview.ts) — NEW. Pur, zéro dépendance React. Exports : `computeProjectedGroupTotal({currentGroupTotal, currentItemAmount?, newItemAmount})` (delta-math identique aux refines Zod), `computeGroupMembersRavPreview({members, currentGroupTotal, projectedGroupTotal}): GroupMemberRavRow[]` (prorata salaire / split égal, delta-math sur currentRav authoritatif).

  **Schémas** :
  - [lib/schemas/budget.ts](../../lib/schemas/budget.ts) — `makeBudgetClientSchema` accepte `strictRav?: boolean` (default `true`). Si `false`, retourne le baseObject sans refine.
  - [lib/schemas/projects.ts](../../lib/schemas/projects.ts) — `makeProjectClientSchema` accepte `strictRav?: boolean`. Le refine 1 (RAV) est appliqué conditionnellement via `strictRav ? base.refine(...) : base`. Le refine 2 (cohérence `monthly × months ≥ remaining`) reste inconditionnel.

  **UI** :
  - [components/dashboard/GroupMembersRavRecap.tsx](../../components/dashboard/GroupMembersRavRecap.tsx) — NEW. Props `{ rows: GroupMemberRavRow[], showPreview: boolean }`. Rend rien si `!showPreview` ou `rows.length === 0`. Layout mobile-first : carte `border-blue-200 bg-blue-50/50`, header "Impact sur le reste à vivre :", une ligne par membre (flex baseline `justify-between`, `truncate` sur le prénom, montants `shrink-0` avec couleur rouge si `willGoNegative`), `<p role="alert" className="text-xs text-red-600">` sous la ligne en cas d'alerte.
  - [components/dashboard/AddBudgetDialog.tsx](../../components/dashboard/AddBudgetDialog.tsx) — ajout props `context?`, `groupMembersRav?`, `currentGroupTotal?`, `strictRav?`. En contexte groupe : recap `<GroupMembersRavRecap>` remplace le bloc "Calcul de la balance" ; calcul `projectedGroupTotal` via `computeProjectedGroupTotal({currentGroupTotal: ?? 0, newItemAmount: previewSafe})`. En perso : recap historique conservé.
  - [components/dashboard/EditBudgetDialog.tsx](../../components/dashboard/EditBudgetDialog.tsx) — symétrique avec `currentItemAmount: currentBudgetAmount` (delta-math edit-in-place).
  - [components/dashboard/AddProjectDialog.tsx](../../components/dashboard/AddProjectDialog.tsx) — symétrique ; `newItemAmount: monthlySafe` (la valeur courante du form, mise à jour via `form.setValue` en mode duration ou saisie directe en mode monthly). Recap remplace le bloc "Marge disponible".
  - [components/dashboard/EditProjectDialog.tsx](../../components/dashboard/EditProjectDialog.tsx) — symétrique avec `currentItemAmount: currentProjectAllocation`.
  - [components/dashboard/PlanningDrawer.tsx](../../components/dashboard/PlanningDrawer.tsx) — nouvelle prop `groupMembersRav?: GroupMemberRavDetail[]` + calcul `currentGroupTotal = isGroupContext ? totalBudgets + totalMonthlyAllocations : undefined` (le total qui pilote `groups.monthly_budget_estimate` via les triggers `sync_group_monthly_budget_estimate` + `sync_group_budget_on_project_change`). Forward aux 4 modals avec `strictRav={!isGroupContext}`.
  - [components/dashboard/FinancialIndicators.tsx](../../components/dashboard/FinancialIndicators.tsx) — passthrough de la prop `groupMembersRav`.
  - [app/(dashboards)/group-dashboard/page.tsx](<../../app/(dashboards)/group-dashboard/page.tsx>) — `groupMembersRav={financialData?.meta?.groupMembersRav}` passé au `<FinancialIndicators>`. Le dashboard perso ne touche à rien.

  **Tests** :
  - [lib/finance/**tests**/group-members-rav-preview.test.ts](../../lib/finance/__tests__/group-members-rav-preview.test.ts) — NEW, 10 cas pur : prorata happy path 2 membres, split égal sumSalaries=0, négatif large warning, édition vers le bas (jamais de warning), membre déjà en déficit, delta nul, liste vide, `computeProjectedGroupTotal` add/edit/down.
  - [components/dashboard/**tests**/GroupMembersRavRecap.test.tsx](../../components/dashboard/__tests__/GroupMembersRavRecap.test.tsx) — NEW, 6 cas RTL : pas de rendu si `showPreview=false`/`rows=[]`, rendu sans warning, rendu avec warning + `role="alert"` + classe rouge, ordre stable, fallback prénom vide → "Membre".

  ### Décisions de design
  - **Délégation à `getProfileFinancialData(memberId)` plutôt qu'à un nouveau calcul inline** : évite la duplication des 6 SELECT (estimated_incomes, real_incomes, estimated_budgets + projects, real_expenses, piggy_bank, etc) qu'aurait nécessité une refonte inline pure. Le coût d'un round-trip Postgres par membre est dominé par la parallélisation Promise.all. **Pattern installé** : pour une projection RAV qui doit MATCHER le dashboard perso, déléguer à la fonction qui produit ce dashboard — ne pas tenter une formule "approximée".
  - **Delta-math au lieu de recompute full** : la formule complète du RAV change uniquement sur le terme `exceptionalExpenses` quand la contribution mirror bouge (trigger `sync_contribution_real_expense`). Donc `projectedRav = currentRav - deltaContribution` est exact. Pas besoin de recomputer tous les termes constants — économise la duplication serveur ET garde le module utility 100% pur côté client.
  - **`strictRav` flag plutôt que schémas séparés** : `makeBudgetClientSchema({strictRav: false})` retourne le baseObject sans refine ; côté projet, le flag conditionne uniquement le refine 1 (RAV), le refine 2 (cohérence durée/target) reste inconditionnel. Default `true` préserve le comportement perso 100% backward-compat.
  - **`currentRav` et `projectedRav` exposés bruts (peuvent être négatifs)** : cohérence stricte avec le dashboard qui affiche aussi le RAV négatif sans clamp. Un membre déjà en déficit est visible comme tel dans le recap (e.g. "−100,00 € → −180,00 €"). `groupMembersPersonalRavTotal` reste clampé par membre (sémantique "capacité collective" pour le plafond validation projets).
  - **Composant `<GroupMembersRavRecap>` réutilisé tel quel par les 4 modals** : 1 source UI unique pour le rendu par-membre, garantit la cohérence visuelle. Props minimales (`rows`, `showPreview`) — le calcul reste responsabilité du parent.
  - **`currentGroupTotal` calculé dans `PlanningDrawer`** (`totalBudgets + totalMonthlyAllocations` en groupe) et passé à chaque modal en prop : single-source-of-truth, évite que les 4 modals dupliquent la même logique d'agrégation. Cohérent avec ce qui pilote `groups.monthly_budget_estimate` côté DB (trigger `recompute_group_monthly_budget_estimate` qui somme budgets + projets).
  - **Validation "warning mais autoriser" en groupe** (vs blocage strict en perso) : choix user explicite. Le perso garde son refine strict (1 seul utilisateur, pas de notion de répartition entre membres). Côté groupe, le warning sur le membre négatif est suffisant pour informer ; bloquer entraînerait des cas pénibles (par exemple : "je veux planifier ce budget même si X est en déficit ce mois").

  ### Test plan manuel
  1. Naviguer `/group-dashboard` → ouvrir Planification → "Ajouter un budget".
  2. Saisir un montant modéré → recap affiche le RAV de chaque membre actuellement + après ajout. Aucun rouge si tout positif.
  3. Saisir un montant qui ferait passer un membre en négatif → ligne du membre passe en rouge avec message d'avertissement, bouton "Ajouter" reste **actif**, submit réussit.
  4. Vérifier post-submit que le dashboard groupe se rafraîchit (TanStack Query invalidation auto, pas de reload nécessaire).
  5. Mode édition d'un budget existant : modifier vers le bas → RAV projeté ≥ RAV actuel, aucun warning.
  6. Mode édition d'un budget existant : modifier vers le haut → delta correctement appliqué (pas de double-comptage de l'ancien montant).
  7. Répéter étapes 2-6 pour `AddProjectDialog` / `EditProjectDialog`.
  8. **Vérifier le perso** (`/dashboard`) : ouvrir les mêmes modals, le recap reste global (pas de vue par-membre), le refine strict bloque toujours le submit si le RAV deviendrait négatif.
  9. **Vérifier la consistance** : sur le recap par-membre d'un membre X, son `currentRav` affiché doit matcher EXACTEMENT ce qu'il voit sur son dashboard perso. Plus de drift.

  ### Verification
  - `pnpm typecheck` : OK
  - `pnpm lint:check` : 0 errors / 0 warnings
  - `pnpm test:run` : 759 → 775 (+16 cas : 10 pure utility + 6 RTL recap component)
  - `pnpm verify` : OK (typecheck + format + tests + db drift/rpcs/functions/types-fresh + audit-functions + audit-objects)
  - 0 nouvelle migration DB (les triggers existants `sync_group_monthly_budget_estimate`, `sync_group_budget_on_project_change`, `calculate_group_contributions`, `sync_contribution_real_expense` gèrent toute la cascade post-submit).
