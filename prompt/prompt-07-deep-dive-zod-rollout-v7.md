# Sprint Zod-Rollout v7 — Extension a11y close buttons + axe-core coverage

> Sprint **optionnel** post-v6 (livré 2026-05-13). Le chantier Zod-client est complètement clos sur 6 sprints (v1 money-first + v2 server-side + v3 client forms + v4 closeout chirurgical + v5 RTL infra + v6 a11y full coverage). v7 est un **filet a11y étendu** sur 2 axes orthogonaux que v6 a explicitement laissés en "extension par opportunité PR-by-PR" :
>
> - **Axe 1** : généraliser le fix close button v6 Axe 5 à tous les modals restants (7 fichiers candidats — même bug class `button-name` détectable par axe-core)
> - **Axe 2** : étendre axe-core audit aux 4-5 surfaces représentatives manquantes (forgot-password, reset-password, inscription, 2-3 client modals)
>
> ⚠️ **Hors scope si pas de bande passante** — c'est de la consolidation a11y, pas un nouveau gap métier. Voir CLAUDE.md §11 v6 entry pour les vrais follow-ups roadmappés (Sprint Tailwind-v4 / Supabase-Strict-Types / Chantier I6 / Lot 6 console-cleanup / OpenAPI).

## Contexte

Sprint v6 (livré 2026-05-13) a fermé l'a11y client-side avec :

- `aria-describedby` + matching `id` sur les 10 forms client non-auth (Axe 1)
- `setFocus(firstErrorKey)` sur les 14 forms (4 auth + 10 client) via `onInvalidSubmit` (Axe 2)
- 3 RTL regression-guards (Axe 3)
- shadcn migration AddIncome+AddBudget name field (Axe 4)
- **axe-core automated audit** via `jest-axe@10.0.0` + pivot manual assert sur 2 surfaces seulement (ConnexionPage + AddBudgetDialog, Axe 5)
- Fix `button-name` critique sur les **2** close X buttons (AddIncomeDialog + AddBudgetDialog) — `aria-label="Fermer"` + `type="button"` + `aria-hidden="true"` sur le `<svg>`

**Le bug class `button-name` (svg-only `<button>` sans nom accessible) a 7 autres occurrences confirmées dans la codebase** :

- `components/dashboard/EditIncomeDialog.tsx` (close X)
- `components/dashboard/EditBudgetDialog.tsx` (close X)
- `components/dashboard/AddTransactionModal.tsx` (close X via shadcn `<Button variant="ghost">`)
- `components/dashboard/EditTransactionModal.tsx` (close X via shadcn `<Button variant="ghost">`)
- `components/dashboard/EditBalanceModal.tsx` — utilise `<Dialog>` shadcn qui a son propre close button (vérifier le composant `<DialogContent>` shadcn pour voir s'il propage un aria-label)
- `components/profile/FirstTimeProfileDialog.tsx` — utilise `<Dialog>` shadcn avec `hideCloseButton={true}` (close X désactivé, mais le dialog title doit être labelled)
- `components/profile/EditProfileDialog.tsx` — utilise `<Dialog>` shadcn avec close X par défaut

L'audit axe-core de v6 a couvert seulement 2 surfaces. Les autres bugs `button-name` ne sont pas régression-guardés.

## Objectifs

### Axe 1 — Normalisation close X buttons (Quick win, ~30 min)

Pour chaque modal listé ci-dessus avec un close X custom (pas le shadcn `<DialogContent>` close X), appliquer le **pattern v6 Axe 5** :

```tsx
<button
  type="button"
  onClick={handleClose}
  aria-label="Fermer"
  className="..."
>
  <svg
    className="..."
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
  </svg>
</button>
```

Diff par fichier (~5 lignes ajoutées) :

- `+type="button"`
- `+aria-label="Fermer"`
- `+aria-hidden="true"` sur le `<svg>` enfant

**Cas particuliers à vérifier Phase 1** :

- **AddTransactionModal + EditTransactionModal** utilisent `<Button variant="ghost" size="sm">` (shadcn) au lieu d'un `<button>` raw. shadcn `<Button>` accepte `aria-label` directement. Vérifier que le SVG enfant n'a pas besoin de `aria-hidden="true"` séparément.
- **EditBalanceModal** utilise `<Dialog>` shadcn — le close X est rendu par `<DialogContent>` qui devrait déjà être a11y-clean. Vérifier en Phase 1 via Read sur le composant `components/ui/dialog.tsx` (regarder le close button avec sa `<X>` icon de lucide-react).
- **FirstTimeProfileDialog** désactive le close X via `hideCloseButton={true}`. Vérifier qu'aucun autre `<button>` svg-only existe dans la modal.

### Axe 2 — Extension axe-core audit (~45 min)

Étendre `components/__tests__/a11y-audit.test.tsx` (créé Sprint v6) avec **4-5 surfaces représentatives** :

```tsx
import ForgotPasswordPage from '@/app/forgot-password/page'
import ResetPasswordPage from '@/app/reset-password/page'
import InscriptionPage from '@/app/inscription/page'
import AddIncomeDialog from '@/components/dashboard/AddIncomeDialog'
import AddTransactionModal from '@/components/dashboard/AddTransactionModal'
```

Cibles candidates (1 commit par surface, ou 1 commit batch) :

| Surface                  | Type        | Mock complexity                                           |
| ------------------------ | ----------- | --------------------------------------------------------- |
| ForgotPasswordPage       | Page route  | `next/navigation`, `@/lib/supabase-client`                |
| ResetPasswordPage        | Page route  | `next/navigation`, `@/lib/supabase-client`, getSession    |
| InscriptionPage          | Page route  | `next/navigation`, `@/lib/supabase-client.signUp`         |
| AddIncomeDialog          | Modal       | aucun mock requis (pure controlled component)             |
| AddTransactionModal      | Modal heavy | 6-hook mock surface (cf. existing test pour le pattern)   |

**Attendre** : 0 à 2 nouvelles violations par surface (mostly close button + form label gaps déjà couverts par Axe 1).

### Axe 3 — Bonus (optionnel, ~15 min)

Format:check des 4 fichiers user drafts pré-existants documentés Sprint v6 plan §Risque 5 :

- `.claude/settings.json`
- `doc2/audit/AUDIT-RESOLUTIONS.md`
- `next.config.js`
- `prompt/prompt-07-deep-dive-recap-algorithm-v7.md`

Si l'utilisateur valide les changements : `pnpm format` sur ces 4 fichiers (cible précise, pas le full repo). Le hook lint-staged prévient toute régression future. Skipper si les fichiers sont du contenu actif (lecture pour confirmer).

## Découpage suggéré (3 commits + closeout)

### Commit 1 — Axe 1 : normalize close X buttons (5 fichiers)

**Touche** : EditIncomeDialog.tsx + EditBudgetDialog.tsx + AddTransactionModal.tsx + EditTransactionModal.tsx + EditProfileDialog.tsx (si le shadcn `<Dialog>` close X n'a pas `aria-label`).

**Pattern à appliquer** : voir ci-dessus.

**Verif** : `pnpm typecheck` + `pnpm lint:check` + relancer `pnpm test:run components/__tests__/a11y-audit.test.tsx` (les 2 cas v6 doivent rester verts).

### Commit 2 — Axe 2 : extension axe-core audit

**Touche** : `components/__tests__/a11y-audit.test.tsx` (+3 à +5 cas).

**Pattern** : mirror du cas ConnexionPage existant (mocks `next/navigation` + `@/hooks/useAuth` ou `@/lib/supabase-client`).

**Verif** : `pnpm test:run components/__tests__/a11y-audit.test.tsx` doit passer (Axe 1 commit a normalisé les close buttons, donc 0 nouvelle violation attendue).

**Risque** : si une nouvelle violation est surfacée (e.g. heading hierarchy, color contrast, alt text), Phase 2 doit la fixer avant merge — pas la suppress avec un disable axe.

### Commit 3 (optionnel) — Axe 3 : format:check 4 user drafts

**Touche** : `.claude/settings.json` + `doc2/audit/AUDIT-RESOLUTIONS.md` + `next.config.js` + `prompt/prompt-07-deep-dive-recap-algorithm-v7.md`.

**Verif** : `pnpm format:check` exit 0.

### Commit 4 — Closeout CLAUDE.md §11 + §9

- §11 nouvelle entrée Sprint Zod-Rollout v7
- §9 update : nombre de cas a11y-audit (2 → 6 ou 7)
- §1 score paragraph : ajout entrée v7 stable (consolidation, pas de saut métier)

## Verification

```powershell
pnpm typecheck
pnpm lint:check
pnpm test:run
pnpm test:run components/__tests__/a11y-audit.test.tsx
```

**Negative greps** :

- `Grep "<button.*onClick.*}>.*<svg" components/dashboard/ components/profile/ -A 3` → tous les hits doivent avoir `aria-label` à proximité
- `Grep "viewBox=\"0 0 24 24\"" --type tsx | grep -v "aria-hidden"` → flag les SVG dans `<button>` sans `aria-hidden`

**Positive greps** :

- `Grep "aria-label=\"Fermer\"" components/` → ≥7 hits (2 existants v6 + 5 nouveaux v7)
- `Grep "axe(container)" components/__tests__/a11y-audit.test.tsx` → 5-7 hits

## Critères de succès

- Lint baseline 180 stable (peut bouger ±1 si Axe 3 surface un format diff non-trivial)
- Tests : 272 → 275-279 (+3 à +5 axe-core extensions)
- ≥7 close X buttons ont `aria-label="Fermer"` + `aria-hidden="true"` sur le `<svg>`
- 0 régression sur les 272 tests existants
- 0 migration DB
- Score estimé : ~99.998 → ~99.998/100 stable (consolidation, pas de saut métier)

## Hors scope (explicite)

- **Sprint Tailwind-v4** — roadmappé §11, indépendant
- **Sprint Supabase-Strict-Types** — roadmappé §11, couplé I5/I6
- **Chantier I6** (logique métier `monthly-recap/{complete,balance,auto-balance}`) — séparé
- **Lot 6 console.log cleanup** — sweep final post-I6
- **OpenAPI / schema-to-docs (R10 audit)** — séparé
- **Other axe rules** (heading hierarchy, color contrast, alt text) — fix as-they-come, ne pas faire un sweep dédié

## Pattern miroir

Identique au Sprint v6 Axe 5 (livré 2026-05-13) — le pattern close button + `aria-label` est déjà documenté dans CLAUDE.md §11 v6 entry. v7 est un copy-paste mécanique étendu.

## Estimation

- Axe 1 : ~30 min (5 fichiers × ~5 LOC diff = ~25 LOC)
- Axe 2 : ~45 min (3-5 nouveaux cas, mocks copy-paste depuis existants)
- Axe 3 (optionnel) : ~10 min
- Closeout : ~15 min

**Total** : 1h-1h30 selon scope final.

## Pourquoi un sprint séparé (et pas inclus dans v6)

Le plan v6 a explicitement choisi "couverture par échantillonnage" pour axe-core (Q1 ne mentionne pas une extension full-coverage) et a fixé les close buttons par opportunité (sur les seules surfaces auditées). Étendre à toutes les surfaces nécessite un audit séparé qui surface potentiellement plus de violations que les 2 cas du v6 — d'où le découpage propre.

**Trade-off documenté** : v7 ne fait pas avancer le score métier ni la dette technique. C'est purement de la consolidation a11y. À déclencher seulement si :
- Un utilisateur signale un problème lecteur d'écran sur un modal
- Le score Lighthouse a11y est à <100 et le user veut combler
- Un audit externe (RGAA, WCAG AA) est planifié

Sinon, laisser dormir et prioriser les vrais follow-ups roadmappés §11.
