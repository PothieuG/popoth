# 04 — Sprint Tailwind-v4 : migration Tailwind 3 → 4

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée `⏭️ Sprint Tailwind-v4` (émergé du Sprint DX-Verify follow-up) |
| **Type** | refactor (migration majeure dépendance) |
| **Priorité** | Haute |
| **Effort estimé** | L (1-2 jours) |
| **Statut** | **Bloqué** par Dependabot ignore rule `tailwindcss: update-types: ["version-update:semver-major"]` |
| **Dépendances** | Aucune (peut être fait en parallèle de 01/02/03/05) |
| **Bloque** | Auto-merge des CVE security PRs Tailwind 4.x.x (rule `update-types` n'affecte que version updates donc en théorie OK, mais CVEs ouverts sur Tailwind 3 ne pourront pas être patché en 4 sans cette migration) |

## Contexte

CLAUDE.md §11 :

> ⏭️ **Sprint Tailwind-v4** (émergé du Sprint DX-Verify follow-up) : migrer tailwindcss 3 → 4. Auto-migration via `npx @tailwindcss/upgrade`. Audit visuel UI complet (shadcn/ui new-york theme tokens peuvent shifter), regen des CSS variables, possible bump @ducanh2912/next-pwa si compat issue. Fichiers touchés : `tailwind.config.ts` (CSS-first ou JS compat), `postcss.config.js` (nouveau plugin `@tailwindcss/postcss`), `app/globals.css` (`@import "tailwindcss"` au lieu de `@tailwind base/components/utilities`).

État des lieux (Sprint DX-Verify follow-up, 2026-05-07) :
- Bump `tailwindcss ^3.4.1 → ^4.2.4` cassé Dependabot wave : **PostCSS plugin déplacé en package séparé `@tailwindcss/postcss`** + **`@tailwind` directives remplacées par `@import "tailwindcss"`**. Compile-time error sur `app/globals.css`.
- Fix-forward : revert tailwind propre + ignore rule `update-types: ["version-update:semver-major"]` ajoutée Sprint Stabilize-Deps S1
- Tailwind v4 apporte : 5x perf compile, CSS-first config (variables CSS au lieu de JS config), `@import "tailwindcss"` syntax, no JIT mode (always JIT)
- shadcn/ui (variant new-york) utilise des theme tokens (`bg-background`, `text-foreground`, etc.) — risque de drift visuel si la palette shifte au mapping v4

**Points d'attention spécifiques à Popoth** :
- `tailwind-merge` est utilisé (CLAUDE.md §11 entrée Sprint Zod-Rollout v8/v9 — drawer override classes via `cn()`) → vérifier compat tailwind-merge avec Tailwind 4
- `prettier-plugin-tailwindcss` est dans la config (CLAUDE.md §6 conventions) → bump probablement requis
- `@ducanh2912/next-pwa` peut avoir des issues compat (cf. mention CLAUDE.md)
- Animations Tailwind utilisées dans `DRAWER_CONTENT_CLASSES` (Sprint Zod-Rollout v9) : `data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom data-[state=open]:zoom-in-100` — vérifier que ces utilitaires existent toujours v4 (probablement via `tailwindcss-animate` plugin)
- `focus-visible:` idiom adopté Sprint Zod-Rollout v6/v8 — déjà v4-compatible
- 12 modals migrés Radix Dialog (Sprint Zod-Rollout v8) avec heavy className overrides → audit visuel modal-by-modal nécessaire

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Migrer le repo de `tailwindcss@^3.4.1` à `tailwindcss@^4.x` (latest stable au moment du sprint), via l'upgrade tool officiel, en garantissant **zero visual regression** (audit visuel des 56 routes + 12 modals Radix migrés v8) et **zéro fail typecheck/lint/test/build**, puis lever l'ignore rule Dependabot.

### 2. Contexte technique

**Fichiers concernés (probable)** :
- `tailwind.config.ts` (refonte CSS-first ou compat JS — décider en Phase 1)
- `postcss.config.js` (nouveau plugin `@tailwindcss/postcss`)
- `app/globals.css` (`@import "tailwindcss"` au lieu de `@tailwind base/components/utilities`)
- `package.json` (deps : `tailwindcss`, `@tailwindcss/postcss`, `prettier-plugin-tailwindcss` bump, `tailwindcss-animate` éventuellement remplacé)
- `pnpm.overrides` (purge override tailwindcss si existant)
- `.github/dependabot.yml` (lever ignore rule)
- **Potentiellement** : tous les fichiers `.tsx` qui utilisent des utilitaires v3-deprecated → l'upgrade tool va les modifier automatiquement

**État actuel** :
- `tailwindcss@^3.4.1` (pinned via `pnpm.overrides` ou direct dep, à confirmer)
- `prettier-plugin-tailwindcss` actif (Sprint 1)
- Custom theme tokens shadcn/ui new-york dans `tailwind.config.ts`
- Animations utilisées : `slide-in-from-bottom`, `slide-out-to-bottom`, `zoom-in-100`, `zoom-out-100`, `data-[state=*]:` variants (Radix Dialog)
- `cn()` utility consomme `tailwind-merge` (vérifier compat v4)

**Tests existants pertinents** :
- 7 cas axe-core dans `components/__tests__/a11y-audit.test.tsx` (Sprint Zod-Rollout v6/v7) — devraient rester verts post-migration
- 12 cas focus-trap regression-guards (Sprint Zod-Rollout v9) — devraient rester verts
- 64 cas RTL forms (Sprint Zod-Rollout v5) — devraient rester verts
- **0 test visuel régression** — c'est le risque principal du chantier

**Précédents codebase** :
- **Sprint DX-Verify follow-up** (CLAUDE.md §11) — première tentative cassée, leçons apprises
- **Sprint Stabilize-Deps S1** (CLAUDE.md §11) — ignore rule installée pour bloquer auto-PR
- Sprint Zod-Rollout v8/v9/v10 — heavy use de classNames Tailwind (12 modals + 2 drawers + ModalCloseX) → audit visuel critique

### 3. Spécifications fonctionnelles attendues

**Cas nominal** : aucune régression visuelle. Toutes les pages, modals, formulaires, drawers, boutons, inputs gardent le rendering pixel-perfect ou near-pixel-perfect (différences <1px d'antialiasing acceptables).

**Cas tolérables** :
- Léger shift de couleur si la palette shadcn theme tokens est re-générée (normalement preserved si CSS variables custom préservées)
- Différences mineures de spacing si la spec v4 a changé une utility (rare)
- Re-order de classes par `prettier-plugin-tailwindcss` v4 (mécanique, pas visual)

**Cas inacceptables** :
- Modal qui ne s'ouvre plus / focus trap cassé / animation broken
- Bouton invisible / mauvais focus color
- Drawer qui n'a plus son layout fullscreen bottom-up
- Form input qui perd son `focus-visible:` ring
- shadcn theme cassé (background/foreground inversés)

### 4. Contraintes techniques

- **Style** : Prettier + ESLint doivent rester verts. Si `prettier-plugin-tailwindcss` v3.x crash sur Tailwind v4, bump à v4.x.
- **Compat** : vérifier compat de :
  - `tailwind-merge` (utilisé dans `cn()`)
  - `tailwindcss-animate` (si utilisé pour les animations Radix)
  - `@ducanh2912/next-pwa` (mentionné CLAUDE.md comme risk)
  - shadcn/ui CLI ne sera **pas** réutilisé (pas de re-init), juste vérifier que les composants `components/ui/*.tsx` qui utilisent shadcn theme tokens fonctionnent toujours
- **CSS variables** : les variables CSS shadcn (`--background`, `--foreground`, `--primary`, etc.) doivent être préservées dans `app/globals.css` post-upgrade
- **Counter `as unknown as SupabaseClient`** : reste à 0 (pas concerné mais vérification de routine)
- **Pattern d'investigation** : commencer par lancer l'upgrade tool sur une branche dédiée + diff complet pour évaluer le scope, **AVANT** de commit

### 5. Critères d'acceptation vérifiables

- [ ] **Tailwind v4 installé** : `package.json` montre `"tailwindcss": "^4.X.Y"` (latest stable au moment du sprint) + `"@tailwindcss/postcss": "^4.X.Y"` (nouveau peer dep)
- [ ] **`postcss.config.js`** : utilise `@tailwindcss/postcss` au lieu de `tailwindcss` direct
- [ ] **`app/globals.css`** : utilise `@import "tailwindcss"` au lieu de `@tailwind base/components/utilities`
- [ ] **Dependabot ignore rule retirée** : `.github/dependabot.yml` ne contient plus `tailwindcss: update-types: ["version-update:semver-major"]`
- [ ] **`pnpm.overrides`** : pas d'override `tailwindcss` résiduel
- [ ] **`pnpm install`** : exit 0, pas de mismatch deps
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0, baseline 183 stable
- [ ] **format** : `pnpm format:check` exit 0 (peut nécessiter `pnpm format` après upgrade pour reorder classes)
- [ ] **tests** : `pnpm test:run` exit 0, 113 passants stable (ou 113+axe-core si on ajoute un test post-migration)
- [ ] **build** : `pnpm build` exit 0, 55/55 routes
- [ ] **`pnpm dev`** : démarre sans erreur PostCSS, hit `curl http://localhost:3000/` retourne 200 (le warning DX-Verify "compile-CSS regressions" doit être absent)
- [ ] **Smoke browser exhaustif** :
  - 5 pages racine : `/`, `/connexion`, `/inscription`, `/forgot-password`, `/reset-password`
  - 4 pages dashboard : `/dashboard`, `/group-dashboard`, `/monthly-recap`, `/settings`
  - 12 modals migrés Radix (Add/EditBudget, Add/EditIncome, Add/EditTransaction, ConfirmationDialog, GroupMembersWithContributions, DeleteGroup, EditBalance, EditProfile, FirstTimeProfile)
  - 2 drawers (PlanningDrawer, SavingsDistributionDrawer + nested transfer modal)
  - Lecteur d'écran : axe-core 7 surfaces toujours 0 violation
- [ ] **Performance** : `pnpm build` time devrait diminuer (Tailwind v4 = 5x plus rapide en théorie). Mesurer avant/après pour le sport.

### 6. Tests à écrire ou à mettre à jour

**Tests à exécuter** :
```powershell
pnpm test:run  # 113 cas non-gated + 64 skipped
```

**Pas de nouveau test gated requis**. Mais considérer d'ajouter :
- 1 cas axe-core supplémentaire post-migration sur une page critique (e.g. `/dashboard` ou `/monthly-recap`) pour pinner le baseline visuel a11y

**Tests à mettre à jour** : si une classe Tailwind utilisée dans un test (e.g. `expect(input).toHaveClass('focus-visible:ring-green-500')`) a changé de syntax v4, adapter.

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : ~99.999/100 stable (consolidation infra, pas de saut métier)
  - **§2 Stack** : `Tailwind 3` → `Tailwind 4`
  - **§6 Format / Prettier** : si `prettier-plugin-tailwindcss` bumpé, mentionner
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint Tailwind-v4** (...) : migration tailwindcss 3 → 4 via @tailwindcss/upgrade tool. ...`
  - **§11** : retirer l'entrée `⏭️ Sprint Tailwind-v4` du backlog déféré

- **`.github/dependabot.yml`** : retirer l'ignore rule + commenter "Tailwind 4 deployed in Sprint Tailwind-v4 [date]"

- **next-steps.md** : pas concerné

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify
git status -s
git checkout -b sprint-tailwind-v4  # branche dédiée pour l'upgrade

# 2. Audit Phase 1 — comprendre les utilisations actuelles
# Grep "@tailwind" app/globals.css  # 3 directives à remplacer
# Grep "tailwind-merge" package.json  # vérifier dep
# Grep "tailwindcss-animate" package.json  # vérifier si utilisé
# Read tailwind.config.ts  # comprendre la config actuelle

# 3. Lancer l'upgrade tool officiel
npx @tailwindcss/upgrade
# Le tool va :
# - Bumper tailwindcss à v4
# - Installer @tailwindcss/postcss
# - Convertir app/globals.css (@tailwind → @import)
# - Convertir tailwind.config.ts vers CSS-first si possible
# - Modifier les utilities deprecated dans les .tsx
# Review le diff intégral AVANT de commit
git diff > tailwind-upgrade.diff
# Read tailwind-upgrade.diff (split en chunks pour review)

# 4. Premier check
pnpm install
pnpm typecheck  # devrait exit 0 (pas de TS impact)
pnpm lint:check
pnpm format  # reorder classes par le plugin v4
pnpm test:run

# 5. Build + dev
pnpm build  # CRUCIAL — le compile-CSS doit passer
pnpm dev  # CRUCIAL — le runtime CSS doit fonctionner
# curl http://localhost:3000/  # 200 attendu

# 6. Smoke browser EXHAUSTIF (cf. critères d'acceptation)
# Visiter chaque route + ouvrir chaque modal + chaque drawer
# Capturer screenshots avant/après si possible (chrome devtools snapshots)
# Comparer pixel-by-pixel les surfaces critiques

# 7. Bump deps secondaires si requis
# Si prettier-plugin-tailwindcss crash : pnpm update prettier-plugin-tailwindcss@latest
# Si tailwindcss-animate incompatible : chercher alternative ou patch local
# Si @ducanh2912/next-pwa CSS issue : voir si bump dispo

# 8. Lever Dependabot ignore + close
# Edit .github/dependabot.yml (retirer ignore rule)
pnpm verify

# 9. Merge sur cleanup (après review)
git checkout cleanup
git merge --no-ff sprint-tailwind-v4
git push origin cleanup
```

## Pièges connus / points d'attention

- **`@tailwindcss/upgrade` n'est pas magique** : le tool gère les cas standards mais pas les classNames dynamiques (`className={\`px-${n}\`}`) ni les classes générées via `cn()` complex. Faire un grep manuel post-upgrade pour les patterns suspects.
- **shadcn/ui new-york theme tokens** : les variables CSS `--background`, `--foreground`, `--primary`, `--muted`, etc. dans `app/globals.css` MUST être préservées. Le tool peut les laisser intactes mais vérifier.
- **`tailwind-merge`** : si v3 incompatible avec utilities v4 (e.g. nouveau prefix), bumper à `tailwind-merge@^3.0+` qui supporte v4.
- **`tailwindcss-animate`** : v4 inclut nativement certaines animations Radix-friendly via `data-[state=*]:` variants. Si le plugin n'est plus nécessaire, le retirer (allègera deps + speedup compile).
- **Drawer animations** (Sprint Zod-Rollout v9 `DRAWER_CONTENT_CLASSES`) : `data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom data-[state=open]:zoom-in-100 duration-300` — vérifier que ces utilities sont toujours générés par v4 ou qu'il faut un plugin/preset.
- **`@ducanh2912/next-pwa`** : il génère du CSS via PostCSS. Si le plugin postcss-tailwindcss change de location, il faut peut-être patch sa config. Risk modéré, à investiguer en Phase 1.
- **prettier-plugin-tailwindcss reorder** : post-upgrade, `pnpm format` va reorder les classes selon la nouvelle convention v4. **Diff massif attendu** sur centaines de fichiers — c'est mécanique et acceptable. Comme Sprint 1 commit `4fc2fb7` (162 files, +6935/-5470 lines), faire 1 commit dédié `chore(format): re-order Tailwind classes per v4 convention`.
- **`@layer base/components/utilities`** : si `tailwind.config.ts` utilise `@layer` directives custom, vérifier que la nouvelle syntax CSS-first les préserve.
- **Dark mode** : Popoth n'utilise probablement pas de dark mode (pas mentionné CLAUDE.md), mais si une route a du `dark:bg-...`, la syntax est inchangée v4.
- **Pre-existing dirty working tree** : si chantier 16 pas encore traité, fortement recommandé de le faire AVANT (un upgrade tailwind avec working tree sale = nightmare diff). Sinon stash + recreate.

## Découpage en sous-tâches (L → 5-7 commits)

1. **Sub-1 (Effort : XS)** — Branche dédiée `sprint-tailwind-v4` + audit Phase 1 (deps actuelles, plugins, theme tokens). Documenter dans le commit message du suivant.
2. **Sub-2 (Effort : S)** — Lancer `npx @tailwindcss/upgrade` + commit le résultat brut `chore(deps): upgrade tailwindcss 3 → 4 via @tailwindcss/upgrade`. C'est le diff "mécanique" du tool.
3. **Sub-3 (Effort : S)** — Re-format Tailwind classes par le plugin v4 + commit `chore(format): re-order Tailwind classes per v4 convention` (massif, mécanique).
4. **Sub-4 (Effort : M)** — Fixes manuels post-upgrade : adapter classNames dynamiques, fixer bugs surfacés par typecheck/lint/test, bump deps secondaires (prettier-plugin-tailwindcss, tailwind-merge, etc.). Commit(s) dédiés `fix(tailwind-v4): <specific fix>`.
5. **Sub-5 (Effort : M)** — Smoke browser exhaustif + ajustements visuels (modal layouts, drawer overrides, focus colors). Commit `chore(ui): adjust visual regressions post-Tailwind-v4`.
6. **Sub-6 (Effort : XS)** — Lever Dependabot ignore + closeout doc. Commit `chore(dependabot): lift Tailwind v4 ignore rule + closeout`.

## Recovery path (si l'upgrade casse trop de choses)

- **Revert sur la branche** : `git checkout cleanup` (la branche `sprint-tailwind-v4` reste dispo pour réessayer plus tard)
- **Re-pin à v3** : `pnpm.overrides: { tailwindcss: "^3.4.1" }` + remettre l'ignore rule
- **Recovery time** : ~10 minutes (juste reset branche + reinstall)

## Précédents codebase (références)

- **Sprint DX-Verify follow-up** (CLAUDE.md §11) — première tentative cassée, leçons apprises (PostCSS plugin déplacé, @tailwind directives changées, ~6 commits revert)
- **Sprint Stabilize-Deps S1** (CLAUDE.md §11) — ignore rule installée + leçon Dependabot
- Sprint 1 commit `4fc2fb7` (CLAUDE.md §11 entrée Sprint 1) — format mass-commit pattern (162 files, +6935/-5470 lines), à reprendre pour le re-format Tailwind v4
- Sprint Zod-Rollout v8/v9/v10 — heavy use Tailwind classNames (modals, drawers, ModalCloseX) — audit visuel pré-merge crucial

---

**Estimation totale** : 1-2 jours, dont :
- ~30% upgrade tool + auto-fix
- ~30% smoke browser exhaustif (56 routes + 12 modals + 2 drawers)
- ~30% fixes manuels post-upgrade (deps secondaires, classNames dynamiques, ajustements visuels)
- ~10% closeout doc + lift ignore

Score métier inchangé (~99.999/100 stable). Bénéfices :
- Performance compile (5x plus rapide en théorie)
- Lève le bloqueur security CVEs Tailwind 4.x
- Modernise la stack avant que l'écart 3 vs 4 ne devienne ingérable
- Prepare le terrain pour shadcn/ui v4 si bump majeur dans le futur
