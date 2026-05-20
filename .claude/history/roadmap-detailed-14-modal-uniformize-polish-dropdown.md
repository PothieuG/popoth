# Roadmap détaillée — Part 14/14 : Modal-Uniformize + Modal-Polish + Modal-Dropdown-Portal

> Créée 2026-05-21 — Part 13 ayant atteint ~37.5k chars (proche du plafond 38k, cf. [@.claude/guardrails/size-policy.md](../guardrails/size-policy.md)), les 3 sprints de la session UI-modals s'ouvrent dans une nouvelle part.
> **Étendue** : Sprint Modal-Uniformize + Sprint Modal-Polish + Sprint Modal-Dropdown-Portal (3 sprints livrés en une session, déclenchés par bug report + review iterative).
> Navigation : [← Part précédente](roadmap-detailed-13-fix-empty-recap-tirelire.md) | (pas de partie suivante)

---

## 11. Roadmap — Part 14/14

- ✅ **Sprint Modal-Uniformize** (livré 2026-05-21, déclenché par 3 demandes user dans un même message : "ajoute un espace entre les € et d'économie / les modals sont trop petites, tout le contenu est tronqué / quand on clique sur 'Autre budget', j'aimerais qu'on switch de page comme dans la modal Ajouter"). 3 changements bundlés en une session :

  **(1) Fix espace € → "d'économies"** dans [components/dashboard/SavingsDistributionDrawer.tsx:334](../../components/dashboard/SavingsDistributionDrawer.tsx) : remplacement du `space` littéral JSX par `&nbsp;` (NBSP entity) entre `{formatCurrency(...)}` et `d&apos;économies` pour garantir un espace insécable visible (le JSX préservait théoriquement l'espace mais le user voyait un collage visuel — `&nbsp;` rend la séparation déterministe).

  **(2) Création de `components/ui/modal-content-classes.ts`** — nouveau constant `MODAL_CONTENT_CLASSES` mirror de `DRAWER_CONTENT_CLASSES` : `flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-xl sm:max-w-md sm:rounded-2xl`. Appliqué aux **13 modals + 1 nested modal** (14 surfaces totales) :
  - Dashboard : `AddBudgetDialog`, `AddIncomeDialog`, `EditBudgetDialog`, `EditIncomeDialog`, `AddTransactionModal`, `EditTransactionModal`, `EditBalanceModal`.
  - Groups : `GroupMembersWithContributionsModal` (override `sm:max-w-2xl` via `cn(MODAL_CONTENT_CLASSES, 'sm:max-w-2xl')` car liste à 2 colonnes), `DeleteGroupModal`.
  - UI : `ConfirmationDialog`.
  - Monthly recap : `MonthlyRecapStep2` transfer/recovery modal.
  - Profile : `EditProfileDialog`, `FirstTimeProfileDialog`.
  - Nested : `SavingsDistributionDrawer` modal de transfert (centered modal, pas drawer fullscreen).

  Pattern interne unifié : header `shrink-0 border-b border-gray-200 px-6 py-4` + body `flex-1 overflow-y-auto px-6 py-4 space-y-4` + footer `shrink-0 border-t border-gray-200 bg-gray-50 px-6 py-4` (le bg-gray-50 sera retiré au Sprint Modal-Polish).

  **(3) Wizard 2-steps dans le modal de transfert d'économies** (mirror du pattern `AddTransactionModal.tsx`) : state `transferWizardStep: 'select-destination' | 'fields'` + handlers `handleSelectTransferDestination(type)` (Tirelire ou Autre budget → switch step 2) + `handleTransferBack` (reset destination + retour step 1). Step 1 affiche source budget + 2 grands boutons cliquables (Tirelire purple / Autre budget blue, style cohérent avec `AddTransactionModal` step 1). Step 2 affiche bouton Retour inline + chip source→destination + amount input + (si destination=budget) dropdown + Cancel/Confirm.

  **Verif end-to-end** : `pnpm typecheck` exit 0 ; `pnpm lint:check` 0/0 ; `pnpm test:run` **494 passed / 90 skipped** stable ; `pnpm format:check` exit 0 (8 fichiers reformatés par prettier post-edit). Score reste **~100 stable**.

  **Trade-off** : Sprint UX cosmétique sans impact métier. Le pattern interne (sticky header + scrollable body + sticky footer) a été corrigé au sprint suivant car `flex-1` sur la wrapper form causait un collapse to 0 dans un parent height-auto (cf. Sprint Modal-Polish).

- ✅ **Sprint Modal-Polish** (livré 2026-05-21, déclenché par review user "C'est mieux mais c'est pas encore ça"). 5 corrections itératives suite Sprint Modal-Uniformize :

  **(1) Bug racine identifié — hauteur des modals capée à ~50vh sur mobile, jamais 85vh.** Root cause : la classe de base `<DialogContent>` de Radix applique `fixed inset-4` (top:16 right:16 bottom:16 left:16) puis `top-[50%]` override sur l'axe vertical. **Avec top:50% ET bottom:16px tous deux actifs**, le CSS calcule `height = viewport.height - 50% - 16 = 50% - 16` (formule des fixed positioned avec top + bottom définis). Le `max-h-[85vh]` ajouté par `MODAL_CONTENT_CLASSES` est seulement un _cap_, pas un _force_, donc la modal restait stuck à ~50vh même avec contenu plus long.

  **Fix** : ajout de `bottom-auto!` (Tailwind v4 `!important` postfix) en première classe de `MODAL_CONTENT_CLASSES` pour libérer la contrainte bottom. Avec bottom:auto, la hauteur devient content-determined, capée par `max-h-[85vh]`. Pattern miroir du `!` override dans `DRAWER_CONTENT_CLASSES` pour `tw-animate-css` (cf. [operational-rules-ui-modals.md](../conventions/operational-rules-ui-modals.md) dernière règle).

  **(2) Bug secondaire — `flex-1` collapsait à 0 dans un parent height-auto.** Quand un flex item a `flex: 1 1 0%` (basis 0%) ET un parent sans hauteur explicite, le contenu du flex item ne contribue pas à la hauteur intrinsèque du parent (basis 0% wins). Combiné avec `overflow-hidden` sur le form wrapper (qui force min-height: 0 pour les flex items), le form/body collapsait à 0 px, faisant croire que tout le contenu scrollait dans un body minuscule.

  **Fix** : remplacement de `flex-1` par `flex-auto` (= `flex: 1 1 auto`) sur les wrappers form + body, ajout de `min-h-0` explicite. Avec basis: auto, l'item prend la taille de son contenu en preferred size puis grow/shrink dans l'espace disponible. La modal s'adapte donc au contenu (variable selon step) avec scroll interne uniquement quand contenu > 85vh.

  **(3) Padding harmonisé `px-6 py-4`** sur header + body + footer de tous les modals (au lieu du mix `p-6` / `px-6 py-4` initial). `bg-gray-50` retiré des footers — laisse juste `border-t border-gray-200` pour la séparation visuelle. Le sticky footer pattern (form wrappe body+footer en deux divs séparés au lieu d'un seul scrollable) est appliqué également à `AddTransactionModal` step 3, `EditTransactionModal`, et `MonthlyRecapStep2` transfer modal.

  **(4) Back button iOS-style intégré au header** (au lieu du inline `<button>...<svg>Retour</button>` en haut du body). Pattern : `<div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3">` + placeholder vide `<div className="h-9 w-9 shrink-0" />` quand on est sur la 1ère step (pour préserver le centrage du titre), ou `<button className="inline-flex h-9 w-9 rounded-full hover:bg-gray-100">` avec icône chevron-left SVG quand step ≥ 2, + `<DialogTitle>` centré flex-1 text-base, + `<ModalCloseX>` à droite. Concerne `AddTransactionModal` (3 steps) + `SavingsDistributionDrawer` nested modal (2 steps). Le bouton est rond `h-9 w-9`, ratio iOS, opacity-50 disabled quand `isSubmitting`.

  **(5) Animation de transition entre steps** (slide + fade rapide ~200ms). State `stepAnimDir: 'forward' | 'backward'` set avant chaque `setWizardStep` selon la direction. Chaque step wrapper utilise `key={'step-XXX'}` pour forcer un remount React + classes `animate-in fade-in duration-200 slide-in-from-right-4` (forward) ou `slide-in-from-left-4` (backward) via `tw-animate-css`. Le `key` est essentiel : sans, le div ne remount pas et l'animation ne re-déclenche pas à chaque step change. Pas d'animation de sortie (l'ancien step disparaît instantanément quand le nouveau prend sa place) — c'est volontaire, pour faire simple sans `framer-motion`. Concerne `AddTransactionModal` + `SavingsDistributionDrawer` nested.

  **Test mis à jour** : [components/dashboard/**tests**/AddTransactionModal.test.tsx:146](../../components/dashboard/__tests__/AddTransactionModal.test.tsx) — le matcher `screen.getByRole('button', { name: /^Retour$/i })` (texte "Retour" exact) changé en `/retour à l'étape précédente/i` (nouvel aria-label icon-only). 1 régression évitée.

  **Verif end-to-end** : `pnpm typecheck` exit 0 ; `pnpm lint:check` 0/0 ; `pnpm test:run` **494 passed / 90 skipped** stable ; `pnpm format:check` exit 0 (3 fichiers reformatés). Score reste **~100 stable**.

  **Pattern à retenir** : pour tout futur composant qui override Radix DialogContent : (a) vérifier si l'ancêtre force une height via positioning fixed + top + bottom ; (b) préférer `flex-auto` à `flex-1` quand le parent peut être height-auto ; (c) `min-h-0` explicite sur les flex items shrinkable (l'auto min-height empêche shrink en-dessous du min-content). Détails complets dans [.claude/conventions/operational-rules-ui-modals.md](../conventions/operational-rules-ui-modals.md).

- ✅ **Sprint Modal-Dropdown-Portal** (livré 2026-05-21, déclenché par request user "quand il y a un dropdown dans les modals, elles doivent avoir un z-index supérieur à tout, j'aimerais qu'elle survole le reste de l'application et non pas qu'elle étende la modal"). Sprint chirurgical 1-fichier sur [components/ui/CustomDropdown.tsx](../../components/ui/CustomDropdown.tsx) :

  **Bug** : Les dropdowns à l'intérieur des modales étaient clipped (visuellement coupés) par les ancêtres. Trois clipping cascadent :
  - `overflow-hidden` sur `<DialogContent>` (nécessaire pour respecter `max-h-[85vh]` sans bavure)
  - `overflow-y-auto` sur le body scrollable (clip vertical strict)
  - `transform: translateY(-50%)` sur `<DialogContent>` (Radix base classe) — crée un **containing-block** pour les descendants `position: fixed`, donc même `position: fixed` ne suffit pas à s'échapper du subtree (spec CSS : "Transformed elements are containing-blocks for fixed-positioned descendants").

  **Fix** : `React.createPortal(menu, document.body)` — le menu est rendu hors du subtree DOM de `<DialogContent>`, donc plus aucun clipping possible. `z-[100]` au-dessus du `z-50` Radix DialogOverlay/DialogContent (Radix par défaut z-50, donc 100 garantit au-dessus).

  **Position calculée dynamiquement** : `getBoundingClientRect()` mesuré sur le button au moment de l'ouverture + sur chaque event `scroll` (capture phase via `addEventListener('scroll', update, true)` pour capter les scrolls internes des ancêtres aussi, notamment le body de la modal) + sur `resize`. Le menu portaled prend `position: fixed; top: button.bottom + 4; left: button.left; width: button.width`.

  **Max-height = `viewport.height - button.bottom - 10vh - 4px`** (per user spec "elle ne sorte jamais de l'écran avec 10% de marge en bas") avec un plancher Math.max(\_, 120px) pour rester utilisable quand le button est très bas dans le viewport. Donc le bas du menu ne descend jamais en-dessous de 90% du viewport.

  **Anti-Radix-close** : `onPointerDown` + `onMouseDown` `stopPropagation()` sur le `<div>` du menu portaled. Raison : Radix DismissableLayer (utilisée par Dialog) écoute `pointerdown` en bubble phase sur `document` pour détecter "clic outside" → si on portale le menu dans body, le clic sur une option de menu remonterait jusqu'à document et Radix le verrait comme "outside" (car le menu n'est pas dans le subtree de DialogContent), fermant le dialog. stopPropagation sur le menu empêche l'event de remonter au-delà → Radix n'est jamais notifié → modal reste ouverte.

  **Click-outside hand-rolled** : deux refs `buttonRef` + `menuRef` (le menu vit dans un subtree séparé via portal). Le handler `document.addEventListener('mousedown', ...)` vérifie via `.contains(target)` les DEUX refs avant de close. Sans cela, cliquer dans le menu portaled serait considéré "outside du button container" et close-rait le menu juste avant le onClick de l'option.

  **A11y ajoutée** : `role="listbox"` sur le wrapper menu, `role="option"` + `aria-selected={value === option.id}` sur chaque button d'option. Pas de gestion focus/keyboard navigation pour l'instant (cas mobile-first PWA, la majorité des users sont touch/tap — déféré si futur user report).

  **Verif end-to-end** : `pnpm typecheck` exit 0 ; `pnpm lint:check` 0/0 ; `pnpm test:run` **494 passed / 90 skipped** stable (les 3 tests qui mockent `CustomDropdown` en `<select>` natif ne sont pas affectés par le refactor du composant réel) ; `pnpm format:check` exit 0. Score reste **~100 stable**.

  **Trade-off** : Pas de fallback "open above" si le button est très près du bas du viewport (le menu sera juste raccourci à 120px min). Si user reporte le cas, ajouter la logique `if spaceBelow < threshold && spaceAbove > spaceBelow → position bottom au lieu de top`. Pas de focus management keyboard (Tab depuis le button skip le menu portaled en raison du focus trap Radix Dialog) — acceptable pour PWA mobile-first, blocking si futur usage desktop power-user.
