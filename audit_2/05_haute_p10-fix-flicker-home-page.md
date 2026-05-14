# 05 — P10 : Fix flicker page d'accueil

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [next-steps.md P10](../next-steps.md) (backlog produit) |
| **Type** | bug UX |
| **Priorité** | Haute |
| **Effort estimé** | S (1-2h) |
| **Statut** | Non commencé |
| **Dépendances** | Aucune |
| **Bloque** | — |

## Contexte

next-steps.md P10 :

> ## P10 — Fix flicker page d'accueil
>
> **Domaine** : auth / UX
>
> Régler le flicker de la page d'information visible quand on arrive sur le site. Probablement lié au flow `useAuthUser()` initial render avant validation de session ([contexts/AuthContext.tsx](../contexts/AuthContext.tsx) `INIT_START` → `INIT_SUCCESS`).

État des lieux :
- **Bug user-visible à chaque visiteur** sur `app/page.tsx` (page d'accueil)
- Flow probable : SSR/CSR mismatch ou état initial `loading: false` avant que `INIT_START` ne lance la validation de session, ce qui rend brièvement la page "guest" puis swap vers la page "authenticated" (ou inversément redirect)
- **Architecture pertinente** :
  - AuthContext useReducer (Sprint 2-followup-v3) : `initialAuthState` est `{ user: null, loading: true, error: null }` (à confirmer par Read)
  - INIT_START → loading: true ; INIT_SUCCESS → loading: false + user
  - `useAuthUser()` subscribe à `AuthUserContext` only (Sprint Hygiène-Code-v2) — re-render minimal
- **Patterns possibles de fix** :
  - **Option 1** : `app/page.tsx` afficher un skeleton/spinner tant que `loading: true` (au lieu de render le content "guest" par défaut)
  - **Option 2** : redirect serveur-side via middleware si on peut détecter la session côté server (déjà fait pour `/dashboard` etc., probablement pas pour `/`)
  - **Option 3** : Suspense boundary autour du content discriminant pour éviter le flash
  - **Option 4** : éviter le flash en faisant le initial render "loading" par default, puis swap vers content guest/auth après INIT_SUCCESS

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Éliminer le flicker visible sur `app/page.tsx` au chargement initial du site. La page doit afficher soit le content "guest" (si pas authentifié) soit redirect vers `/dashboard` (si authentifié), **sans flash transitoire** de l'un avant l'autre.

### 2. Contexte technique

**Fichiers concernés** :
- `app/page.tsx` (entry point home, identifier le flow render)
- `contexts/AuthContext.tsx` (vérifier le initialAuthState + flow INIT_START → INIT_SUCCESS)
- `contexts/auth-reducer.ts` (state machine, Sprint 2-followup-v4)
- `hooks/useAuth.ts` (`useRequireGuest` + `useLogin` + `useLogoutAndRedirect` exposés Sprint 2-followup-v5)
- `middleware.ts` (vérifier si la route `/` est dans la matcher list, et si oui que faire)
- `lib/session-server.ts` (validateSessionToken — utilisé par middleware probablement)

**État actuel** :
- AuthContext useReducer (Sprint 2-followup-v3) — `dispatch` pour state transitions
- `initialAuthState` à vérifier — probablement `{ user: null, loading: true, error: null }`
- `INIT_START` set `loading: true`, `INIT_SUCCESS` set `loading: false, user`, `INIT_ERROR` set `loading: false, error`
- `useAuthUser()` retourne `{ user, loading, error, isLoggedIn }` (mémoizé, Sprint 2-followup-v4)

**Tests existants pertinents** :
- `lib/__tests__/auth-reducer.test.ts` (14 cas pure-unit, Sprint 2-followup-v4)
- `app/connexion/__tests__/page.test.tsx` (RTL, Sprint Zod-Rollout v5)
- **Probablement 0 test sur `app/page.tsx`** — à créer 1-2 cas RTL pour pinner le no-flicker contract post-fix

**Précédents codebase** :
- Sprint Hygiène-Code-v2 (CLAUDE.md §11) — split `app/page.tsx` consommant `useAuthUser()` (single concern)
- Sprint 2-followup-v3 (CLAUDE.md §11) — useReducer migration, exhaustiveness check via `never`
- Sprint 2-followup-v4 (CLAUDE.md §11) — extraction reducer + memoize Context value

### 3. Spécifications fonctionnelles attendues

**Cas nominal A — Visiteur non authentifié** :
- Hit `/` (cold load)
- **Pendant la validation de session** (~50-300ms typique) : afficher un skeleton ou un loader minimal (logo + spinner discret), **PAS le content guest qui flicker**
- **Après INIT_SUCCESS avec `user: null`** : render le content guest (CTA inscription/connexion, pitch produit)
- Aucune navigation forcée (l'utilisateur reste sur `/`)

**Cas nominal B — Visiteur authentifié** :
- Hit `/` (cold load avec session cookie valide)
- **Pendant la validation** : skeleton/loader (idem A)
- **Après INIT_SUCCESS avec `user: <obj>`** : redirect vers `/dashboard` (ou `/group-dashboard` si `profile.group_id`) via `router.replace('/dashboard')`
- L'utilisateur n'aperçoit JAMAIS le content guest

**Cas edge** :
- Session cookie absent → INIT_SUCCESS rapide avec `user: null` → render guest sans transit
- Session cookie expiré → INIT_ERROR → render guest avec optionnel toast "Session expirée"
- Network slow / Supabase lent → loader visible plus longtemps, mais pas de flicker
- User refresh quick toggle entre `/` et `/dashboard` → pas de boucle

**Cas erreur** :
- Erreur réseau → INIT_ERROR → render guest avec error banner discret (pas un crash)

### 4. Contraintes techniques

- **Style** : suivre conventions CLAUDE.md §6 (no `console.log`, imports `import type`, Prettier strict)
- **Pas de regression a11y** : si on ajoute un loader, lui donner `role="status"` + `aria-live="polite"` + texte sr-only "Chargement"
- **Pas de regression auth flow** : ne PAS modifier le AuthContext init flow (Sprint 2-followup-v3 a stabilisé). Le fix devrait vivre dans `app/page.tsx` (ou un middleware soft-redirect) — pas dans AuthContext.
- **Pas de SSR si évitable** : `app/page.tsx` est probablement déjà 'use client' (consomme `useAuthUser`). Si on veut faire du SSR avec session cookie pour redirect server-side, c'est plus complexe (nécessite refactor Next.js Server Component + cookie API). **Recommandé** : Option 1 (loader CSR) en premier, Option 2 (server redirect via middleware) si user demande explicitement.
- **Counter `as unknown as SupabaseClient`** : reste à 0
- **Préserver les conventions auth existantes** : `useRequireGuest()` / `useLogoutAndRedirect()` sont les hooks canoniques (Sprint 2-followup-v5). Si l'un des 2 ne convient pas exactement, créer un nouveau hook plutôt que modifier les 3 existants.

### 5. Critères d'acceptation vérifiables

- [ ] **Pas de flicker visible** : visiter `/` 5 fois en cold load (DevTools "Disable cache" + "Slow 3G") + visiter en authentifié — l'utilisateur ne doit JAMAIS voir le content guest "puis" redirect, ni le inverse
- [ ] **Loader a11y** : `Grep "role=\"status\"" app/page.tsx` retourne ≥ 1 hit, `Grep "aria-live" app/page.tsx` retourne ≥ 1 hit (si on ajoute un loader)
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0, baseline 183 stable
- [ ] **format** : `pnpm format:check` exit 0
- [ ] **tests** : `pnpm test:run` exit 0, +1-2 cas RTL non-gated sur `app/page.tsx` (pinner loader-then-content flow)
- [ ] **build** : `pnpm build` exit 0
- [ ] **Lighthouse Performance** : score sur `/` reste ≥ 85 (le loader ne doit pas dégrader)
- [ ] **smoke browser** :
  - Cold load `/` non-authentifié → loader visible bref puis content guest, pas de flash inverse
  - Cold load `/` authentifié (cookie valide) → loader visible bref puis redirect vers `/dashboard`, pas de flash content guest
  - Lighthouse a11y `/` reste ≥ 95

### 6. Tests à écrire ou à mettre à jour

#### RTL non-gated — `app/__tests__/page.test.tsx` (~2-3 cas)

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import HomePage from '../page'

// Mock AuthContext
let mockAuthState = { user: null, loading: true, error: null, isLoggedIn: false }
vi.mock('@/hooks/useAuth', () => ({
  useAuthUser: () => mockAuthState,
  useRequireGuest: () => ({ isGuest: !mockAuthState.user, loading: mockAuthState.loading }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }))

describe('HomePage flicker fix', () => {
  beforeEach(() => {
    mockAuthState = { user: null, loading: true, error: null, isLoggedIn: false }
  })

  it('renders loading state when auth is initializing', () => {
    render(<HomePage />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    // Le content guest NE DOIT PAS être visible pendant loading
    expect(screen.queryByText(/inscription/i)).not.toBeInTheDocument()
  })

  it('renders guest content after INIT_SUCCESS with user: null', async () => {
    mockAuthState = { user: null, loading: false, error: null, isLoggedIn: false }
    render(<HomePage />)
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.getByText(/inscription/i)).toBeInTheDocument()
  })

  it('redirects to /dashboard after INIT_SUCCESS with user', async () => {
    const replaceMock = vi.fn()
    vi.mocked(require('next/navigation').useRouter).mockReturnValue({ replace: replaceMock })
    mockAuthState = { user: { id: 'u1', email: 'a@b.c' }, loading: false, error: null, isLoggedIn: true }
    render(<HomePage />)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'))
  })
})
```

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : ~99.999 stable (UX fix, pas de saut métier)
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint P10-Fix-Home-Flicker** : ferme P10 du backlog produit. ...`
- **next-steps.md** : retirer P10 de la liste (passer en "✅ Fait" ou supprimer carrément + renumérote rester)

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
git status -s

# 2. Phase 1 — investigation (Read-only)
# Read app/page.tsx (état actuel)
# Read contexts/AuthContext.tsx + contexts/auth-reducer.ts (initialAuthState + flow)
# Read middleware.ts (la route '/' est-elle dans matcher ? si oui, comment elle est gérée?)
# Read app/dashboard/page.tsx (pattern useRequireAuth ou similaire pour comparaison)

# 3. Implementation
# Edit app/page.tsx :
# - Si pas déjà : 'use client' au top
# - useAuthUser() pour lire { user, loading }
# - Si loading: render loader avec role="status"
# - Si !loading && user: useEffect → router.replace('/dashboard')
# - Si !loading && !user: render content guest

# 4. Tests
# Write app/__tests__/page.test.tsx (3 cas)
pnpm test:run app/__tests__/page.test.tsx

# 5. Validation totale
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm test:run
pnpm build

# 6. Smoke browser
pnpm dev
# Cold load `/` non-auth (Cmd+Shift+R devtools "Disable cache") → loader puis guest
# Cold load `/` auth → loader puis /dashboard, jamais flash guest
# Lecteur d'écran : "Chargement" annoncé pendant loader

# 7. Lighthouse
# DevTools > Lighthouse > Run audit sur '/' :
# - Performance ≥ 85
# - Accessibility ≥ 95
```

## Pièges connus / points d'attention

- **`router.replace` vs `redirect`** : utiliser `router.replace` (client-side, dans useEffect) **PAS** `redirect()` Next.js (server-side, peut crash dans 'use client'). Le redirect server-side via middleware est l'Option 2 (plus complexe).
- **Middleware redirect server-side (Option 2)** : si le middleware peut valider la session (via `validateSessionToken(request)` Edge-safe — déjà importé pour `/dashboard` etc.), il peut faire un `NextResponse.redirect(new URL('/dashboard', req.url))` avant que la page CSR ne render. Élimine totalement le flicker MAIS plus complexe à implémenter et debugger. **Recommandé Option 1 d'abord** (loader CSR), passer à Option 2 si Option 1 insuffisante.
- **Suspense boundary (Option 3)** : peut être utilisé si on veut que le loader vive dans `app/loading.tsx` (Next.js convention). Plus idiomatique App Router mais nécessite refactor.
- **Initial state `loading: true`** : Sprint 2-followup-v3 a probablement set `loading: true` par défaut (pour éviter le flicker inverse). À confirmer par Read sur `auth-reducer.ts:initialAuthState`. Si `loading: false` par défaut, il faut le passer à `true` (mais attention aux side effects sur les autres consumers).
- **`useRequireGuest()` hook** : Sprint 2-followup-v5 expose ce hook qui pourrait être ce qu'on veut (redirect to dashboard if user). Vérifier sa logique exacte par Read.
- **Test SSR mismatch** : si `app/page.tsx` est Server Component partiellement, `useAuthUser` ne marche pas. Vérifier si le composant est `'use client'` au top.
- **Pre-existing dirty working tree** : si chantier 16 pas encore traité, exclure de ce commit.

## Découpage en sous-tâches (S → 2 commits)

1. **Sub-1 (Effort : XS)** — Phase 1 audit (Read AuthContext, page.tsx, middleware.ts, useAuth.ts hooks). Documenter l'état actuel + l'option choisie dans le commit message.
2. **Sub-2 (Effort : S)** — Implementation + tests + closeout. Commit `fix(home): eliminate auth flicker on initial render (P10)` + closeout doc en commit séparé `docs: closeout CLAUDE.md §11 + next-steps.md for P10`.

## Recovery path

- `git revert <sha>` — pas de migration DB, pas d'effet persistant. Recovery trivial.

## Précédents codebase (références)

- Sprint Hygiène-Code-v2 (CLAUDE.md §11 entrée Sprint Hygiène-Code-v2) — split AuthContext consumers, app/page.tsx migré à `useAuthUser()`
- Sprint 2-followup-v3 (CLAUDE.md §11) — useReducer migration AuthContext, init flow stabilisé
- Sprint 2-followup-v4 (CLAUDE.md §11) — extraction reducer pure-unit testable + memoize Context value

---

**Estimation totale** : 1-2h. Ferme P10 du backlog produit. UX visible immédiatement à chaque visiteur du site. ROI maximal pour effort S. Recommandé en bundle avec chantier 03 (UserGroupsList) — les 2 sont S et indépendants, peuvent être fait dans la même session de 3-4h.
