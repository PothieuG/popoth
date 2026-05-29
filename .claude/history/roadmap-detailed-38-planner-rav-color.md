# Part 38 — Planner-RAV-Color (reste à vivre estimé vert/rouge dans les encarts du planificateur)

> Sprint livré 2026-05-29 sur branche `dev`. Les encarts récap des modals d'ajout/modif
> (budget / revenu / projet) du `PlanningDrawer` affichent désormais **l'estimation du
> reste à vivre** (`actuel → projeté`) avec code couleur **vert si positif / rouge si
> négatif**, en solo comme en groupe. Miroir solo de l'encart groupe `GroupMembersRavRecap`
> (Part 32).

## Contexte

Avant ce sprint, les encarts récap solo étaient hétérogènes et ne montraient jamais le
**vrai** reste à vivre :

- **Budget perso** → « Balance résultante » = `revenus estimés − budgets` (ignore les
  projets, ignore les déficits/exceptionnels → pas le RAV authoritative).
- **Revenu perso** → « Total des revenus » (pas de RAV, aucune couleur).
- **Projet perso** → « Marge disponible » (ne soustrayait même pas le nouveau projet).

Côté groupe (Part 32 / Group-RAV-Recap), `GroupMembersRavRecap` affichait déjà le RAV
projeté par membre, mais en **gris/noir quand positif** (rouge seulement si négatif). Et
l'encart revenu groupe (`GroupMembersContributionsRecap`, Part 37) montrait les
contributions, pas le RAV.

## Décisions produit (AskUserQuestion 2026-05-29)

1. **Format solo = « avant → après »** : une ligne épurée `RAV actuel → RAV projeté`, le
   projeté coloré vert/rouge (PAS de breakdown détaillé). Rejette « détail + total coloré ».
2. **Revenu groupe = « Contributions + RAV »** : garder `contribution X → Y` par membre
   ET ajouter `reste à vivre X → Y` coloré vert/rouge en dessous. Rejette « RAV seul »
   (perte du détail contributions) et « garder contributions » (pas de couleur RAV).
3. **Portée = ajout + modification** (les 6 modals).

## RAV courant = valeur authoritative + delta-math

Pas de recalcul approximatif : on part du RAV **authoritative** et on applique le delta de
l'opération en cours (même raisonnement que [group-members-rav-preview.ts](../../lib/finance/group-members-rav-preview.ts)).

- **Solo** : `financialData.remainingToLive` — déjà dans `FinancialIndicators` (prop
  `remainingToLive`), threadé jusqu'aux modals via `PlanningDrawer` (nouvelle prop
  `currentRav`). En contexte groupe, les modals ignorent `currentRav` (recap par membre
  via `groupMembersRav`).
- **Groupe** : `meta.groupMembersRav[].currentRav` par membre (déjà threadé Part 32).

| Modal (perso) | RAV projeté |
| ------------- | ----------- |
| AddBudget | `currentRav − previewSafe` |
| EditBudget | `currentRav − (previewSafe − budget.estimated_amount)` |
| AddIncome | `currentRav + previewSafe` |
| EditIncome | `currentRav + (previewSafe − income.estimated_amount)` |
| AddProject | `currentRav − monthlySafe` |
| EditProject | `currentRav − (monthlySafe − project.monthly_allocation)` |

Exactitude : les budgets/projets « entamés » sont gatés à l'édition (`isBudgetStarted` →
info dialog) donc le delta est exact ; un revenu estimé fraîchement ajouté n'a pas de réel
⇒ `incomeCompensation` compte son montant estimé plein ([income-compensation.ts](../../lib/finance/income-compensation.ts)) ;
les projets comptent toujours `monthly_allocation` plein dans `totalEstimatedBudgets`.

**Revenu groupe** : ajouter un revenu commun baisse la contribution de chaque membre
(`delta < 0`) donc son RAV perso **monte** : `projectedRav = currentRav − delta` (même
delta-math que budget/projet ; la contribution est une dépense exceptionnelle « miroir »
dans le RAV perso du membre).

## Fichiers

**Nouveaux** :

- [components/dashboard/rav-color.ts](../../components/dashboard/rav-color.ts) — `ravColorClass(amount)` :
  `< 0` → `text-red-600`, `> 0` → `text-green-600`, `= 0` → `text-gray-900`. Source de
  vérité unique du code couleur RAV, partagée par les 3 surfaces. Aligné sur
  `getAmountColorClass` du dashboard.
- [components/dashboard/RavProjectionRecap.tsx](../../components/dashboard/RavProjectionRecap.tsx) —
  encart solo « Reste à vivre estimé : actuel → projeté » (panel bleu, miroir de
  `GroupMembersRavRecap`). Avertissement `role="alert"` si le RAV passerait négatif. Le
  bouton de soumission reste actif (RAV négatif autorisé depuis 2026-05-27).

**Modifiés** :

- Les 6 modals ([AddBudgetDialog](../../components/dashboard/AddBudgetDialog.tsx),
  [EditBudgetDialog](../../components/dashboard/EditBudgetDialog.tsx),
  [AddIncomeDialog](../../components/dashboard/AddIncomeDialog.tsx),
  [EditIncomeDialog](../../components/dashboard/EditIncomeDialog.tsx),
  [AddProjectDialog](../../components/dashboard/AddProjectDialog.tsx),
  [EditProjectDialog](../../components/dashboard/EditProjectDialog.tsx)) : branche perso
  passe à `<RavProjectionRecap>` ; ajout prop `currentRav` ; calcul `projectedRav` inline.
- [GroupMembersRavRecap.tsx](../../components/dashboard/GroupMembersRavRecap.tsx) : RAV
  projeté positif → vert via `ravColorClass` (avant `text-gray-900`). Warning rouge conservé.
- [group-members-contributions-preview.ts](../../lib/finance/group-members-contributions-preview.ts) :
  `GroupMemberContributionRow` enrichi `currentRav` + `projectedRav` (= `currentRav − delta`).
- [GroupMembersContributionsRecap.tsx](../../components/dashboard/GroupMembersContributionsRecap.tsx) :
  sous-ligne « Reste à vivre : actuel → projeté » colorée par membre, sous la contribution.
  Titre → « Impact sur les contributions et le reste à vivre ». Warning rouge si projeté < 0.
- [PlanningDrawer.tsx](../../components/dashboard/PlanningDrawer.tsx) : nouvelle prop
  `currentRav`, forwardée aux 6 modals.
- [FinancialIndicators.tsx](../../components/dashboard/FinancialIndicators.tsx) : passe
  `currentRav={remainingToLive}` au drawer.

## Nettoyage (dead code Path B)

Les anciens encarts perso étaient les seuls consommateurs des props d'affichage
`totalEstimatedIncome` / `currentBudgetsTotal` / `currentIncomesTotal` /
`currentAllocatedTotal` (les schémas Zod `makeBudgetClientSchema` /
`makeProjectClientSchema` / `createIncomeFormSchema` ne les utilisent PAS pour la
validation — vérifié). Retirées des 6 modals. Cela a orphéliné, en cascade :

- les plafonds vestigiaux `budgetCeiling` / `projectCeiling` / `projectAllocatedTotal` dans
  `PlanningDrawer` (devenus display-only depuis le retrait du blocage RAV-négatif
  2026-05-27, `strictRav` retiré Part 32) → supprimés ;
- les props `groupSalaryTotal` / `groupMembersPersonalRavTotal` de `PlanningDrawer` +
  `FinancialIndicators` + [group-dashboard/page.tsx](<../../app/(dashboards)/group-dashboard/page.tsx>) → supprimées.

⚠️ **Reste à nettoyer (hors scope, candidat follow-up)** : `meta.groupSalaryTotal` et
`meta.groupMembersPersonalRavTotal` sont toujours **calculés côté serveur**
([financial-data.ts](../../lib/finance/financial-data.ts)) et asservis par
`financial-data.test.ts`, mais n'ont plus de consommateur UI. Laissés en place (contrat
`FinancialData.meta`, calcul trivial) ; suppression serveur = sprint dédié si souhaité.

## Tests

- **Nouveaux non-gated** : [rav-color.test.ts](../../components/dashboard/__tests__/rav-color.test.ts)
  (3 cas vert/rouge/gris) ; [RavProjectionRecap.test.tsx](../../components/dashboard/__tests__/RavProjectionRecap.test.tsx)
  (masquage / vert positif / rouge négatif + alerte) ; [GroupMembersContributionsRecap.test.tsx](../../components/dashboard/__tests__/GroupMembersContributionsRecap.test.tsx)
  (contribution + RAV par membre, vert/rouge, surplus).
- **Mis à jour** : 6 tests de modals (props `currentRav` au lieu des display props) ;
  [a11y-audit.test.tsx](../../components/__tests__/a11y-audit.test.tsx) ;
  [GroupMembersRavRecap.test.tsx](../../components/dashboard/__tests__/GroupMembersRavRecap.test.tsx)
  (assertion vert sur RAV projeté positif) ;
  [group-members-contributions-preview.test.ts](../../lib/finance/__tests__/group-members-contributions-preview.test.ts)
  (assertions `currentRav`/`projectedRav`).
- `PlanningDrawer.test.tsx` inchangé (stubs les modals, ne passe aucune prop retirée).

Aucune migration DB, aucun changement backend/RPC (feature 100% présentation client).

## Vérification

- `pnpm typecheck` exit 0.
- `pnpm lint:check` 0/0.
- `pnpm test:run` : **823 passants** / 234 skipped (+11 vs 812 baseline).
- `pnpm format:check` : mes fichiers propres (3 `scripts/seed-recap/*.mjs` en échec
  pré-existant, hors diff — sprint `dde4ce9`).
- `pnpm build` : 45 routes, OK.
- Vérification visuelle mobile (≤ 430px) : encart solo budget/revenu/projet + groupe.
