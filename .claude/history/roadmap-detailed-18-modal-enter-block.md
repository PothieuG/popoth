# Roadmap détaillé — Part 18 : Modal-Forms-Block-Enter-Submit

> Chronologie des sprints livrés à partir de 2026-05-21 (suite de [roadmap-detailed-17-delete-header-income-polish.md](roadmap-detailed-17-delete-header-income-polish.md)). Split préemptif pour rester sous le cap 39.5k chars/fichier.

## Sprints

- ✅ **Sprint Modal-Forms-Block-Enter-Submit** (livré 2026-05-21, déclenché par "je veux obliger les gens à appuyer sur le bouton de validation les modals d'ajout et de suppression de depense, revenu, budget, revenu planifié... en gros toutes les modals, appuyer sur entrée sur un input de montant fait juste disparaitre le clavier" → clarification AskUserQuestion "j'aimerais obliger les gens à cliquer sur le bouton" → portée élargie à tous les inputs des forms modaux).

  **Constat pré-sprint** : sur mobile (cible iPhone Safari/Chrome ≤430 px), appuyer sur "Go"/"Return" du clavier numérique (`inputMode="decimal"`) ou texte dans un input wrapped dans un `<form onSubmit={handleSubmit}>` déclenche le submit implicite du navigateur (HTML5 form behavior). Cas user : remplir le montant, presser Return pour fermer le clavier et continuer à éditer un autre champ → la modale se ferme prématurément avec le formulaire dans un état incomplet. Symptôme aggravé sur les wizards `AddTransactionModal` (step 3 = form) où le user veut juste fermer le clavier pour revoir le résumé de catégorisation avant de cliquer "Ajouter".

  **Architecture installée** :

  **(1) Helper `preventEnterSubmit`** ([lib/forms/prevent-enter-submit.ts](../../lib/forms/prevent-enter-submit.ts), 22 LOC) : `onKeyDown` handler à brancher sur les `<form>` des modals/drawers. Intercepte la touche `Enter` (sans modificateurs Shift/Ctrl/Meta/Alt) sur tout target qui n'est ni `<textarea>` (multi-line input légitime), ni `<button>` (clic intentionnel sur un bouton focus), ni `<a>` (lien). Action : `e.preventDefault()` (bloque le submit implicite HTML5) + `target.blur()` (ferme le clavier mobile sur iOS Safari / Chrome). Safe-guard `target instanceof HTMLElement` pour les events synthétiques.

  **(2) Branchement sur 10 sites `<form>` modaux** (1 ligne par site, import + prop) :
  - [components/groups/CreateGroupForm.tsx](../../components/groups/CreateGroupForm.tsx)
  - [components/dashboard/AddBudgetDialog.tsx](../../components/dashboard/AddBudgetDialog.tsx) + [EditBudgetDialog.tsx](../../components/dashboard/EditBudgetDialog.tsx)
  - [components/dashboard/AddIncomeDialog.tsx](../../components/dashboard/AddIncomeDialog.tsx) + [EditIncomeDialog.tsx](../../components/dashboard/EditIncomeDialog.tsx)
  - [components/dashboard/AddTransactionModal.tsx](../../components/dashboard/AddTransactionModal.tsx) (step 3 wizard `<form key="step-fields">`) + [EditTransactionModal.tsx](../../components/dashboard/EditTransactionModal.tsx)
  - [components/dashboard/EditBalanceModal.tsx](../../components/dashboard/EditBalanceModal.tsx)
  - [components/profile/FirstTimeProfileDialog.tsx](../../components/profile/FirstTimeProfileDialog.tsx) + [EditProfileDialog.tsx](../../components/profile/EditProfileDialog.tsx)

  **(3) Modals/drawers sans `<form>` non touchés** : `DeleteGroupModal` (Input + onClick handler, pas de form-tag → pas de submit possible), `ConfirmationDialog` (2 buttons, pas d'inputs), `SavingsDistributionDrawer` (raw `<input>` dans un Drawer non-form). Pressing Enter sur un input isolé hors `<form>` ne déclenche aucun submit côté navigateur — le helper est inutile.

  **Tests** : 7 nouveaux cas dans [lib/forms/\_\_tests\_\_/prevent-enter-submit.test.tsx](../../lib/forms/__tests__/prevent-enter-submit.test.tsx) (env jsdom, `.tsx` car DOM types) :
  - Enter sur `<input>` → `preventDefault` + `blur` appelés
  - Enter sur `<textarea>` → no-op (multi-line préservée)
  - Enter sur `<button type="submit">` → no-op (clic intentionnel)
  - Enter sur `<a>` → no-op
  - Tab / Escape / 'a' / ArrowDown sur input → no-op (autres touches passent)
  - Enter+Shift/Ctrl/Meta/Alt sur input → no-op (modificateurs réservés)
  - Target null (event synthétique) → no-throw safe

  Tests passants 513 → **520** (+7). Lint:check 0/0. Format:check clean. Typecheck exit 0.

  **Files livrés** :
  - **Nouveaux** (2) : `lib/forms/prevent-enter-submit.ts` + `lib/forms/__tests__/prevent-enter-submit.test.tsx`.
  - **Modifiés source** (10) : les 10 forms modaux ci-dessus, chacun avec 2 edits (import + prop `onKeyDown={preventEnterSubmit}` sur `<form>`).

  **Trade-off / leçons apprises** :
  - **Form-level interception > field-level interception** : tentation initiale de modifier `DecimalFormInput` (centralized pour amount inputs uniquement). Rejeté après clarification user "j'aimerais obliger les gens à cliquer sur le bouton" — portée élargie à TOUS les inputs (incl. text fields name/description). Form-level `onKeyDown` est le seul point unique qui catche les 2 types d'inputs sans toucher à chaque field component.
  - **Passe-droit `<button>` même si focus-then-Enter = submit** : un user qui Tab jusqu'au bouton submit puis presse Enter le veut explicitement. Bloquer ici aurait cassé l'a11y keyboard navigation (cf. WCAG 2.1.1 Keyboard). Le passe-droit `<a>` est cohérent (anchor Enter = navigation, pas submit).
  - **Passe-droit modificateurs Shift/Ctrl/Meta/Alt** : défensif pour ne pas bloquer un raccourci futur (e.g. Ctrl+Enter = submit explicite est un pattern existant dans certaines apps SaaS). Aucun raccourci de ce type actuellement dans Popoth, mais le coût du passe-droit est ~0 et la réversibilité high.
  - **Test `.tsx` pas `.ts`** : le helper ne render pas de React, mais les tests utilisent `document.createElement` (DOM). Vitest config `test.projects` split env=node `*.test.ts` / env=jsdom `*.test.tsx` → file extension drive l'environnement. Rename `.test.ts` → `.test.tsx` au lieu de mocker manuellement les HTMLElement (plus simple, plus réaliste).
  - **Pas de modif `DecimalFormInput`** : le composant reste un wrapper pur sans logique de submit. Si plus tard on veut un Enter→Tab-to-next-field pattern (UX plus mobile-friendly), c'est une 2e couche orthogonale au form-level submit block.

  **Pattern à retenir** :
  - **Tout nouveau `<form>` dans un modal/drawer doit avoir `onKeyDown={preventEnterSubmit}`** sauf cas explicite où le submit-on-Enter est souhaité (e.g. un search bar single-input). Cas non actuellement présent dans Popoth.
  - **Mobile-first signature** : sur viewport ≤430 px, le clavier on-screen occupe 40-60 % de la hauteur. "Return"/"Go" sur le clavier numérique ou texte doit fermer le clavier (= `blur`) plutôt que submit, pour permettre à l'utilisateur de relire le formulaire avant validation explicite.
  - **Forms non-wrapped (input isolé hors `<form>`)** sont déjà safe — le navigateur ne soumet rien sans form-tag. Inutile d'ajouter le helper. Mais si on enveloppe un input dans un `<form>` plus tard pour validation Zod, penser à brancher le helper.
