# Sprint Zod-Rollout v6 — Complétion a11y des forms non-auth + bonus UX

> ⚠️ Lire d'abord [`CLAUDE.md`](../CLAUDE.md) §6 (Pattern A-H validation Zod), §9 (Tests RTL + a11y regression-guards), §11 entrée Sprint Zod-Rollout v5 (livré 2026-05-13).
> Le v5 a installé l'infra RTL + 64 cas + a11y `aria-describedby` + `role="alert"` sur les 4 auth forms uniquement. Le v6 ferme le chantier a11y en étendant le même pattern aux 9 forms non-auth + ajoute du focus-management UX.

## Contexte

Le Sprint Zod-Rollout v5 (2026-05-13) a installé :

1. **Infra RTL complète** : `jsdom@25` + `@testing-library/{react,user-event,jest-dom}` + `test.projects` split (env=node pour `*.test.ts` / env=jsdom pour `*.test.tsx`) + `vitest.setup.ts` (jest-dom + auto-cleanup).
2. **64 tests RTL** non-gated sur 15 fichiers couvrant DecimalFormInput + 14 client forms.
3. **A11y partial** : `aria-describedby` linkant input↔error sur **4 auth forms uniquement** (forgot/reset/connexion/inscription) + `role="alert"` sur **10 serverError boxes** (4 auth + 6 non-auth).

**Surface a11y restante** (les inputs des 9 forms non-auth n'ont PAS encore d'`aria-describedby` reliant input ↔ error `<p>`) :

| Form                         | Inputs avec error inline                                | Status htmlFor       |
| ---------------------------- | ------------------------------------------------------- | -------------------- |
| `FirstTimeProfileDialog.tsx` | first_name, last_name                                   | ✅ htmlFor linké     |
| `EditProfileDialog.tsx`      | first_name, last_name                                   | ✅ htmlFor linké     |
| `CreateGroupForm.tsx`        | name, monthly_budget_estimate (DecimalFormInput)        | ✅ htmlFor linké     |
| `AddIncomeDialog.tsx`        | name (raw `<input>`), estimatedAmount (DecimalFormInput) | ❌ **PAS de htmlFor** |
| `EditIncomeDialog.tsx`       | name, estimatedAmount                                   | ✅ htmlFor linké     |
| `AddBudgetDialog.tsx`        | name (raw `<input>`), estimatedAmount (DecimalFormInput) | ❌ **PAS de htmlFor** |
| `EditBudgetDialog.tsx`       | name, estimatedAmount                                   | ✅ htmlFor linké     |
| `AddTransactionModal.tsx`    | description, amount, FK dropdown                        | ✅ htmlFor partiel   |
| `EditTransactionModal.tsx`   | description, amount, FK dropdown                        | ✅ htmlFor partiel   |
| `EditBalanceModal.tsx`       | balance                                                 | ✅ htmlFor linké     |

**Gap UX additionnel** (mentionné v5 plan §Axe 5 + §Risk #4) : aucun form n'utilise `form.setFocus(name)` dans `onInvalidSubmit` — quand un user submit avec des erreurs, le focus ne va pas au premier champ en erreur, il reste sur le submit button. C'est un détail d'UX classique mais réel.

**Items mineurs surfacés v5** (cf. §Axe 6) :

- `DecimalFormInput` cleanOnBlur : tape `12.` puis tab out → reste `12.` au lieu de `12`. Trade-off doc-only en v5 ; à reconsidérer si UX flake.
- `AddIncomeDialog` + `AddBudgetDialog` utilisent raw `<input>` au lieu de shadcn `<Input>` pour le champ `name` (cosmétique, low-priority).
- Pre-existing format:check : 4 fichiers user drafts (`.claude/settings.json`, `doc2/audit/AUDIT-RESOLUTIONS.md`, `next.config.js`, `prompt-07-deep-dive-recap-algorithm-v7.md`). Si l'utilisateur valide les changements, `pnpm format` les normalise.

## Scope (à arbitrer Phase 1)

**Axe 1 — A11y complétion non-auth forms (obligatoire core)** :

Pour chacun des 9 forms non-auth, ajouter le pattern `aria-describedby` + `id` sur l'`<p>` d'erreur. Pour les 2 forms avec labels sans `htmlFor` (AddIncomeDialog + AddBudgetDialog), ajouter aussi `htmlFor` + `id` sur les labels (qui débloque accessibility de base + cleane les tests RTL existants qui tournent via `getByPlaceholderText`).

Estimation : ~30-45 minutes. ~9 fichiers touchés. Lint baseline stable.

**Axe 2 — Focus management on invalid submit (UX)** :

Pour les 4 auth forms (highest impact UX, où un user qui se trompe d'email/password doit voir le focus revenir au champ fautif), ajouter `form.handleSubmit(onValidSubmit, onInvalidSubmit)` où `onInvalidSubmit` appelle `form.setFocus(firstErrorField)`.

Alternative scope plus large : étendre à tous les forms. Trade-off : 14 sites × ~5 lignes ; UX gain limité pour les modals (le user voit déjà le focus rester dans le modal).

Estimation : 15 min pour auth seulement, 45 min pour tous les forms.

**Axe 3 — Tests RTL des nouveaux a11y attributes (regression-guard)** :

Pour valider que les changements d'Axe 1 ne se perdent pas, étendre 2-3 tests RTL existants avec des assertions a11y. Pattern miroir de `forgot-password.test.tsx` (déjà fait en v5) :

- AddBudgetDialog.test.tsx : empty name → `aria-describedby='budget-name-error'` + `aria-invalid='true'` sur l'input
- EditIncomeDialog.test.tsx : empty name → idem
- AddTransactionModal.test.tsx : RAV blocking → `role='alert'` sur serverError

Estimation : 15-20 min, 3 fichiers de test touchés.

**Axe 4 — Bonus (optionnel)** :

- **`AddIncomeDialog` + `AddBudgetDialog`** : migrer le `<input>` name de raw HTML vers shadcn `<Input>` (mirror du pattern v4 pour les décimaux). Cosmetic, élimine la divergence entre les 2 forms `Add*` (raw) vs les 2 forms `Edit*` (shadcn) du domaine.
- **`DecimalFormInput.cleanOnBlur`** : ajouter une prop `cleanOnBlur?: boolean` (default false pour rétro-compat) qui strip le `.` final ou `-` solitaire sur blur. Pin via 2 cas RTL ajoutés dans `DecimalFormInput.test.tsx`. Trade-off : si l'utilisateur veut conserver l'état partial pour navigation clavier (e.g. typer `12,` puis revenir corriger), ne pas activer par défaut.
- **Format:check** : `pnpm format --write` sur les 4 fichiers pre-existing OU ajout `.prettierignore` (au choix user — ce sont ses drafts). Quick win, lint pre-commit hook protège automatiquement après.

**Axe 5 — axe-core automated audit (optionnel, deferred)** :

Installer `axe-core` + `@axe-core/react` (dev dependency) et ajouter 1-2 tests RTL automatisés qui lancent axe sur le DOM rendu pour catcher les régressions a11y automatiquement (heading levels, alt text, contrast, etc.). Trade-off : ajoute ~2MB de devDeps et ~500ms de test, mais devient un vrai filet de sécurité contre les régressions a11y.

Skip si pas de bande passante — axe-core peut suivre un v6-followup.

## Décisions à demander à l'utilisateur (Phase 1)

- **Q1 — Scope** :
  - (a) Axe 1+2+3 (a11y core + focus auth + RTL guards) — ~1h, **Recommended**
  - (b) Axe 1+2+3+4 (+ bonus shadcn migration + cleanOnBlur) — ~2h
  - (c) Axe 1+2+3+4+5 (+ axe-core) — ~3h
  - (d) Axe 1 only (juste la complétion a11y minimale) — ~30 min
- **Q2 — Scope focus management (Axe 2)** :
  - (a) Auth forms uniquement (4 sites) — **Recommended**
  - (b) Tous les forms (14 sites)
- **Q3 — DecimalFormInput cleanOnBlur (Axe 4)** :
  - (a) Skip (deferred, ajouter doc-only Pattern H+ dans CLAUDE.md §6) — **Recommended**
  - (b) Implémenter en opt-in (cleanOnBlur prop default false)
- **Q4 — Découpage commits** :
  - (a) 1 commit par axe (2-5 commits selon scope) — **Recommended**
  - (b) 1 commit par fichier (bruyant mais bissect-friendly)

## Fichiers concernés (scope a)

```
M (×9)  forms touched a11y                                # aria-describedby + id pairs (Axe 1)
M (×2)  AddIncomeDialog.tsx + AddBudgetDialog.tsx         # htmlFor on labels (Axe 1)
M (×4)  auth forms                                        # onInvalidSubmit + setFocus (Axe 2)
M (×3)  test files                                        # a11y regression-guards (Axe 3)
M       CLAUDE.md                                         # §11 entrée v6 + §9 a11y test patterns
```

**Cible** : a11y complet sur tous les forms client + focus management auth + lint baseline 180 stable + tests 267 → 270 (+3 RTL a11y guards).

## Verification

```bash
pnpm typecheck && pnpm lint:check && pnpm test:run
```

**Negative greps** (après Axe 1) :

- `Grep "aria-describedby" components/profile/ components/groups/ components/dashboard/` → ≥9 hits (1 par form non-auth)
- `Grep "htmlFor=" components/dashboard/{AddIncomeDialog,AddBudgetDialog}.tsx` → ≥2 hits

**Positive greps** (après Axe 2) :

- `Grep "setFocus" app/{forgot,reset,connexion,inscription}-*` → ≥4 hits
- `Grep "onInvalidSubmit" app/{forgot,reset}-*` → ≥2 hits

**Smoke browser deferred to user** :

- Tab dans `/dashboard` AddBudget : avec une erreur, focus revient au champ fautif
- Tab dans `/connexion` avec email invalide : focus retourne sur email input
- Screen reader (VoiceOver/NVDA) sur `/inscription` empty submit → annonce de l'erreur via `aria-describedby` linkage

## Critères de succès

- Lint baseline 180 stable
- Tests : 267 → ~270 (+3 a11y regression-guards via Axe 3)
- ≥9 forms non-auth ont l'attribut `aria-describedby` propagé
- ≥4 auth forms ont `setFocus` sur invalid submit
- 0 régression sur les 264 tests existants
- 0 migration DB
- Score estimé : ~99.997 → ~99.998/100 (consolidation a11y full coverage)

## Pattern miroir

Réutilise le pattern Axe 5 du Sprint v5 :

```tsx
// Pattern aria-describedby
<Input
  aria-invalid={fieldErrors.X ? 'true' : 'false'}
  aria-describedby={fieldErrors.X ? 'form-prefix-X-error' : undefined}
  // ...
/>
{fieldErrors.X && (
  <p id="form-prefix-X-error" className="...">{fieldErrors.X.message}</p>
)}

// Pattern setFocus (Axe 2)
const onInvalidSubmit = (errors: FieldErrors<FormType>) => {
  const firstErrorField = Object.keys(errors)[0]
  if (firstErrorField) {
    form.setFocus(firstErrorField as FieldPath<FormType>)
  }
}

const handleSubmit = form.handleSubmit(onValidSubmit, onInvalidSubmit)
```

ID-prefixes spécifiques par form (e.g. `budget-name-error`, `income-amount-error`) pour éviter les collisions SPA (mirror du pattern v5 `login-email-error` / `signup-email-error`).

## Out of scope (explicite)

- **axe-core automated audit** : Axe 5 optionnel, peut suivre un v6-followup
- **Visual regression / snapshot tests** — bricolage fragile, refusé v5
- **Playwright/E2E** — refusé v5 (0 use case)
- **Sprint Tailwind-v4 / Supabase-Strict-Types / Chantier I6 / Lot 6 console-cleanup** — roadmappés CLAUDE.md §11

## Prochaine étape après v6

Si Axe 1+2+3 livrés : **a11y client-side complètement aligné** (CLAUDE.md §11 mettra à jour le score). Le chantier Zod-client est totalement fermé (5 sprints + 1 a11y completion).

Si Axe 4 (bonus) livré : élimine 2 sites de divergence raw `<input>` vs shadcn `<Input>` + cleanOnBlur UX subtlety.

Pas de v7 anticipé sauf émergence d'un trou nouveau au smoke browser réel.

## Estimation totale

- Scope (a) : ~1h dev + 15 min closeout CLAUDE.md
- Scope (b) : ~2h dev + 20 min closeout
- Scope (c) : ~3h dev + axe-core scaffolding + 30 min closeout
- Scope (d) : ~30 min dev (minimal a11y only)
