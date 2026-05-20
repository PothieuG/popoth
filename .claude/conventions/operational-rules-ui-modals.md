# Règles opérationnelles — Modals & UI (suite de §5 de [operational-rules.md](operational-rules.md))

> Extraction 2026-05-20 (Sprint Drawer-Slide-Fix-And-Header-Harmonize) — `operational-rules.md` ayant franchi le plafond 38k de la [size-policy](../guardrails/size-policy.md), la sous-section "Modals & UI" de §5 est déplacée ici. Toutes les autres sous-sections de §5 (Séquences non-atomiques, God-files, Idempotency, RAV formula, budget_transfers, recover route, recover 5 tables, Tests gated, Tables owner-row, Colonnes mirror, Forbidden absolus) restent dans le fichier principal.

## Modals & UI

- ❌ **NE PAS** créer de nouveau modal en raw `<div className="fixed inset-0 ...">` — utiliser `<Dialog>` + `<DialogContent>` (Sprint Zod-Rollout v8). 12 surfaces v8 migrées, 12 tests focus-trap regression-guards.
- ❌ **NE PAS** réintroduire un raw `<button onClick> ... <svg path d="M6 18L18 6M6 6l12 12">...</svg></button>` pour le close X d'un modal → utiliser `<ModalCloseX>` (Sprint v10).
- ❌ **NE PAS** réintroduire un wizard single-step `AddTransactionModal` — le wizard 2-step (Step 1 type / Step 2 budgétée-exceptionnelle / Step 3 fields, income skips Step 2) est requis pour P6.
- ❌ **NE PAS** réintroduire le pattern cascade-aggressive piggy→savings→budget dans `calculateBreakdown` — P4 strict default → budget priorité 1, savings cascade UNIQUEMENT si overflow, piggy JAMAIS auto-débitée.
- ❌ **NE PAS** utiliser `window.location.href = '/<route>'` pour naviguer vers une sous-vue qui peut cohabiter dans un drawer/menu déjà ouvert (cas vu Sprint Refactor-Settings-Drawer 2026-05-18 : ancien drawer paramètres → bouton "Gestion du groupe" → `window.location.href = '/settings'` provoquait un full reload + bug intermittent 1/2 sur `history.back()`). Pattern correct : swap horizontal in-place via `[view, setView] = useState<'main'|'sub'>('main')` + 2 panels `absolute inset-0` + `translate-x-{-full,0,full}` + container `overflow-hidden`. Référence : [components/settings/SettingsDrawer.tsx](../../components/settings/SettingsDrawer.tsx).
- ❌ **NE PAS** mettre un loading overlay fullscreen `fixed inset-0 bg-black/50` dans un drawer/sub-panel — préférer **spinner inline** sur les boutons submit + **snackbar non-bloquante z-[60]** sur success (pattern `ProfileSettingsCard.tsx:266-275`). Pour le loading initial d'un fetch dans un panel : skeleton `animate-pulse` léger localisé sur la Card concernée (pattern `ProfileSettingsCard.tsx:33-44`).
- ❌ **NE PAS** imbriquer des `<Card>` (Card racine → Card interne avec actions inline → 2-3 Cards frères) dans un panel de drawer qui doit rester épuré type iOS Settings. Pattern correct (Sprint Rework-Group-Management 2026-05-19, sur [components/settings/GroupManagementPanel.tsx](../../components/settings/GroupManagementPanel.tsx)) : **sections plates** `<section className="space-y-N">` empilées dans un container `space-y-6 overflow-y-auto`, **`<dl>` flat label/valeur** avec séparateurs subtils `border-b border-gray-100 py-2`, **CTA prominent en haut** (style menu-item iOS gradient bleu-indigo, miroir `SettingsDrawer.tsx:92-127`). La Card chrome avec ombre + bordure n'apporte rien dans un panel déjà délimité par le drawer.
- ❌ **NE PAS** placer un bouton d'action destructive ("Quitter", "Supprimer le compte", "Se déconnecter") inline dans le content d'un panel — utiliser un **footer pinned bottom** (`<div className="border-t border-gray-200 p-4">` après le `flex-1 overflow-y-auto`) avec `<Button>` full-width orange ou red. Pattern miroir `SettingsDrawer.tsx:146-154` "Se déconnecter" rouge ; `GroupManagementPanel.tsx` footer "Quitter le groupe" orange (warning, réversible). Le footer slot rend l'action prévisible peu importe la longueur du scroll content.
- ❌ **NE PAS** afficher un bouton actif pour une action que le backend va refuser (false-affordance UX). Pattern correct (Sprint Rework-Group-Management 2026-05-19) : **encart d'info ambré** (`border-amber-200 bg-amber-50 text-amber-800`) au-dessus du bouton expliquant la règle + **bouton désactivé** (`disabled` + `aria-disabled` + `disabled:cursor-not-allowed`) + **handler court-circuité** (defense-in-depth contre click programmatique) + **règle backend matchée** (vérifier `/api/...` retourne 403 dans le même scénario). Exemple : creator avec membres ne peut pas quitter le groupe — encart explique, bouton greyé, handler return early, backend DELETE renvoie 403.
- ❌ **NE PAS** toujours-mounter un composant lourd (qui fait des `useQuery` / `fetch`) à l'intérieur d'un drawer/modal masqué par défaut via CSS (translate off-screen, opacity 0, display visible-mais-pas-vu) — lazy-mount via state flag `hasBeenOpened` initialisé à false, set à true à la 1re ouverture. Pattern "adjust state during render" React 19 (`if (isOpen && !hasBeenOpened) setHasBeenOpened(true)` directement dans le body, PAS dans un `useEffect` car ESLint `react-hooks/set-state-in-effect` refuse `setState` synchrone dans effect). Précédent Sprint Lazy-Mount-GroupManagementPanel 2026-05-20 : `<SettingsDrawer>` rendait toujours `<GroupManagementPanel>` même drawer fermé (juste `-translate-x-full`), `useGroups()` du panel firait `GET /api/groups` à chaque mount dashboard, jamais consommé. Bénéfice prod : 1 fetch en moins par mount. Pattern miroir applicable à tout panel "slot" d'un drawer (sub-views horizontales, modals d'édition). Référence : [components/settings/SettingsDrawer.tsx:34-39](../../components/settings/SettingsDrawer.tsx).
- ❌ **NE PAS** overrider des utilitaires Tailwind v4 `tw-animate-css` qui ciblent la **même CSS custom property** (`--tw-enter-*` / `--tw-exit-*` posés par `slide-in-from-*`, `slide-out-to-*`, `zoom-in/out-*`, `fade-in/out-*`, `spin-in/out-*`, `blur-in/out-*`) sans `!` postfix sur les classes d'override. Tailwind v4 émet les utilités triées alphabétiquement dans le CSS compilé, la cascade prend la dernière assignation : l'override silencieusement perd l'ordre HTML. Précédent Sprint Drawer-Slide-Fix-And-Header-Harmonize 2026-05-20 : `<DialogContent>` base (`slide-in-from-top-[48%]` + `slide-in-from-left-1/2` + `zoom-in-95`) battait `DRAWER_CONTENT_CLASSES` override (`slide-in-from-bottom` + `zoom-in-100`) sur 3 vars → drawer animait en diagonale top-left + zoom au lieu de slider depuis le bas pendant 6 jours. Fix : `slide-in-from-bottom!` / `zoom-in-100!` / `[--tw-enter-translate-x:0]!` (arbitrary CSS var pour neutraliser l'axe non-overridé). Pattern à appliquer à toute future migration shadcn/Radix primitive (Dialog, Popover, Tooltip, DropdownMenu, Toast) ou drawer `vaul`. Header drawer harmonisé sur le template `<SavingsDistributionDrawer>` (icône `h-10` + svg `h-5` + titre `text-xl` + bg `{color}-50/30` + close `<ModalCloseX variant="circle" h-10 w-10>`) — drag handle décoratif supprimé sur fullscreen drawer sans drag-to-dismiss réel. Référence : [components/ui/drawer-content-classes.ts](../../components/ui/drawer-content-classes.ts).

- ❌ **NE PAS** créer un nouveau modal sans utiliser [`MODAL_CONTENT_CLASSES`](../../components/ui/modal-content-classes.ts) comme `className` de `<DialogContent>` (Sprint Modal-Uniformize + Modal-Polish 2026-05-21). Le constant définit `bottom-auto! flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-xl sm:max-w-md sm:rounded-2xl`. Le `bottom-auto!` est **critique** car Radix DialogContent base applique `fixed inset-4` (bottom:16) + `top-[50%]`. Avec top:50% ET bottom:16 tous deux actifs, le CSS calcule height = 50vh − 16 sur mobile (formule des fixed-positioned avec top+bottom définis), donc la modal était bloquée à ~50% du viewport indépendamment de `max-h-[85vh]` (qui n'est qu'un cap, pas un force). Le `!` postfix Tailwind v4 garantit la cascade winner sur la classe `bottom-4` de la base. Override de width via `cn(MODAL_CONTENT_CLASSES, 'sm:max-w-2xl')` quand un modal nécessite plus de largeur (seul `GroupMembersWithContributionsModal` aujourd'hui).

- ❌ **NE PAS** utiliser `flex-1` sur un wrapper form/body à l'intérieur d'un `<DialogContent>` MODAL_CONTENT_CLASSES — utiliser **`flex-auto` + `min-h-0`** (Sprint Modal-Polish 2026-05-21). Raison : `flex-1` = `flex: 1 1 0%` (basis 0%) → l'item ne contribue pas à la hauteur intrinsèque du parent height-auto, donc le body collapse à 0 et tout le contenu scrolle dans un body minuscule. `flex-auto` = `flex: 1 1 auto` (basis = content size) → l'item prend la taille de son contenu en preferred size puis grow/shrink dans l'espace disponible. `min-h-0` explicite est requis sur les flex items shrinkable (l'auto min-height empêche shrink en-dessous du min-content, ce qui peut bloquer le scroll interne). Pattern modal complet :

  ```tsx
  <DialogContent className={MODAL_CONTENT_CLASSES}>
    <div className="shrink-0 border-b border-gray-200 px-6 py-4">…header…</div>
    <form className="flex min-h-0 flex-auto flex-col overflow-hidden" onSubmit={…}>
      <div className="min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-4">…body…</div>
      <div className="shrink-0 border-t border-gray-200 px-6 py-4">…footer (submit btn)…</div>
    </form>
  </DialogContent>
  ```

- ❌ **NE PAS** mixer les paddings dans un même modal (ex: header `p-6` + body `px-6 py-4` + footer `px-6 py-3`) — uniformiser sur **`px-6 py-4`** (16 vertical, 24 horizontal) sur header / body / footer (Sprint Modal-Polish 2026-05-21). User feedback : "Certaines modals ont un padding en bas trop large". Cause : combinaison `p-6` body (24 bottom) + `px-6 py-4` footer (16 top) = 40px gap entre last field et buttons + 16px footer bottom = ~56px de bottom area, ressenti comme oversized. **Retirer aussi le `bg-gray-50`** des footers — laisser juste `border-t border-gray-200` pour la séparation. Le sticky footer (form wrappe body+footer en deux divs séparés) est appliqué partout, pas un single scrollable form avec buttons inline (ces derniers scrollent avec le contenu, mauvais UX pour les forms longs).

- ❌ **NE PAS** mettre un bouton "Retour" texte inline en haut du body d'un step de wizard (`<button>...<svg arrow-left/>Retour</button>` au-dessus de la summary chip) — utiliser un **back button iOS-style intégré au header**, top-left, icon-only chevron, rond (Sprint Modal-Polish 2026-05-21). Pattern :

  ```tsx
  <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3">
    {isFirstStep ? (
      <div className="h-9 w-9 shrink-0" />  {/* placeholder, preserve centrage du titre */}
    ) : (
      <button
        type="button"
        onClick={handleBack}
        disabled={isSubmitting}
        aria-label="Retour à l'étape précédente"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
      >
        <svg className="h-5 w-5" .../>chevron-left</svg>
      </button>
    )}
    <DialogTitle asChild>
      <h2 className="flex-1 text-center text-base font-semibold text-gray-900">{stepTitle}</h2>
    </DialogTitle>
    <ModalCloseX onClose={handleClose} disabled={isSubmitting} variant="ghost" className="h-9 w-9" />
  </div>
  ```

  Le titre `text-base font-semibold flex-1 text-center` reste centré entre back (left) et close (right). Si futur RTL needed, swap left/right via classes logical (start/end).

- ❌ **NE PAS** changer le wizardStep sans setter un `stepAnimDir: 'forward' | 'backward'` AVANT le `setWizardStep` — sinon l'animation entre steps part dans la mauvaise direction (Sprint Modal-Polish 2026-05-21). Pattern :

  ```tsx
  const [stepAnimDir, setStepAnimDir] = useState<'forward' | 'backward'>('forward')

  const goNext = () => {
    setStepAnimDir('forward')
    setWizardStep('next')
  }
  const goBack = () => {
    setStepAnimDir('backward')
    setWizardStep('prev')
  }

  // In render — `key={'step-XXX'}` ESSENTIEL pour forcer remount + re-trigger animation :
  {
    wizardStep === 'step-X' && (
      <div
        key="step-X"
        className={cn(
          'min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-4',
          'animate-in fade-in duration-200',
          stepAnimDir === 'forward' ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
        )}
      >
        …content…
      </div>
    )
  }
  ```

  Pas d'animation de sortie (l'ancien step disparaît instantanément). Si futur besoin riche, migrer vers `framer-motion` `AnimatePresence`. Sans `key`, React réutilise le même div pour les différents steps et l'`animate-in` ne re-déclenche pas.

- ❌ **NE PAS** rendre un dropdown menu/popover en `<div className="absolute z-50 mt-1">` à l'intérieur d'un modal — le menu sera **clipped** par 3 cascades (Sprint Modal-Dropdown-Portal 2026-05-21) : (a) `overflow-hidden` sur DialogContent ; (b) `overflow-y-auto` sur le body scrollable ; (c) `transform: translateY(-50%)` sur DialogContent base (Radix) qui crée un **containing-block pour les descendants `position: fixed`**, donc même fixed positioning ne s'échappe pas du subtree. **Fix obligatoire** : portal vers `document.body` via `React.createPortal()` + `position: fixed` avec coordonnées calculées via `getBoundingClientRect()` sur le button trigger, + `z-[100]` (au-dessus du z-50 Radix) + reposition sur events `scroll` (capture phase via `addEventListener('scroll', update, true)` pour capter les scrolls internes des ancêtres) + `resize`. Pattern de référence : [components/ui/CustomDropdown.tsx](../../components/ui/CustomDropdown.tsx).

  **Sub-règle anti-Radix-close** : si le menu portaled est rendu dans un contexte où Radix Dialog est open, **stopPropagation sur `onPointerDown` + `onMouseDown`** du wrapper du menu. Raison : Radix DismissableLayer écoute `pointerdown` en bubble phase sur `document` pour détecter "clic outside". Si le menu est portaled dans body (hors subtree de DialogContent), le clic sur une option remonte jusqu'à document et Radix le voit "outside" → ferme le dialog. stopPropagation sur le menu coupe le bubble avant qu'il n'atteigne document.

  **Sub-règle max-height** : la max-height d'un menu portaled = `window.innerHeight - buttonRect.bottom - bottomMargin - 4` (avec `bottomMargin = window.innerHeight * 0.1` = 10% margin du bas du viewport, per design system). Plancher `Math.max(_, 120)` pour rester utilisable quand le button est très bas. Le bas du menu ne descend jamais en-dessous de 90% du viewport. Pas de fallback "open above" pour l'instant — ajouter `if spaceBelow < threshold && spaceAbove > spaceBelow → position bottom au lieu de top` si futur user report.

  **Sub-règle click-outside avec portal** : 2 refs nécessaires (`buttonRef` + `menuRef`) car le menu est dans un subtree DOM séparé. Le handler `document.addEventListener('mousedown', ...)` doit vérifier `.contains(target)` sur les DEUX refs avant de close. Sans ça, cliquer dans le menu portaled est considéré "outside du button container" et ferme le menu juste avant l'onClick de l'option.
