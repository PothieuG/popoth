# [10] — Wizard shell + frise progression + écran lock groupe

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3 — wizard 5 écrans mobile-first plein-écran, navigation forward-only, état persisté pour resume après déco.
- Position dans la séquence : étape 10/17
- Dépend de : 03 (state lib + check-status), 05 (status endpoint)
- Débloque : 11, 12, 13 (chaque step component)

## Objectif
Créer le squelette UI du wizard : `RecapWizard.tsx` (host avec frise + step router) + `GroupLockScreen.tsx` (autre membre en train de faire le recap). Au mount, le wizard fetch /api/monthly-recap/status, route sur l'écran correct selon `current_step`. Si `kind='locked_by_other'`, affiche lock screen avec bouton "Se déconnecter".

## Fichiers concernés
- `components/monthly-recap/RecapWizard.tsx` — à créer (host wizard)
- `components/monthly-recap/RecapProgressFrieze.tsx` — à créer (frise 5 étapes)
- `components/monthly-recap/GroupLockScreen.tsx` — à créer (écran bloquant)
- `components/monthly-recap/RecapShell.tsx` — à créer (layout plein-écran + container responsif)
- `app/monthly-recap/page.tsx` — à créer (mount le wizard, server component avec context query param)
- `hooks/useMonthlyRecap.ts` — à créer (state machine client : fetch status, advance step, error handling)
- `lib/recap/index.ts` — à LIRE (re-exports types)
- `app/dashboard/page.tsx` — à LIRE pour pattern layout existant
- `lib/api/with-auth.ts` — pas modifier, juste comprendre

## Patterns et conventions à respecter
- **Mobile-first** strict : viewport ≤ 430px (cf. CLAUDE.md §6 UI). Pas de breakpoints `md:`/`lg:`. Tester en DevTools mobile viewport.
- **shadcn/ui + Tailwind 4** : utiliser les composants existants (Button, Card, Drawer Radix). Pattern `cn()` pour merger classes.
- **TanStack Query** pour fetch status : `useQuery({ queryKey: ['recap', 'status', context], queryFn: ... })`. Pas de fetch raw dans useEffect.
- **`router.replace`** (pas `router.push`) pour les redirections post-completion (cf. CLAUDE.md `❌ Auth + recap nav` règle).
- **Animations slide** : utiliser `tw-animate-css` pattern existant (`animate-in slide-in-from-right-4`) pour transitions entre steps. Voir [components/dashboard/](../components/dashboard/) pour exemples.
- **`'use client'`** au top du wizard et hooks (composants interactifs).
- **Skeleton loader pendant fetch initial** : pas de spinner, skeleton placeholder pour les sections.

## Détail des composants

### `app/monthly-recap/page.tsx`

```tsx
import { Suspense } from 'react'
import { RecapShell } from '@/components/monthly-recap/RecapShell'
import { RecapWizard } from '@/components/monthly-recap/RecapWizard'

export default function MonthlyRecapPage({ searchParams }: { searchParams: Promise<{ context?: string }> }) {
  return (
    <Suspense fallback={<RecapShell><p>Chargement…</p></RecapShell>}>
      <MonthlyRecapPageContent searchParams={searchParams} />
    </Suspense>
  )
}

async function MonthlyRecapPageContent({ searchParams }: { searchParams: Promise<{ context?: string }> }) {
  const params = await searchParams
  const context: 'profile' | 'group' = params.context === 'group' ? 'group' : 'profile'
  return <RecapWizard context={context} />
}
```

### `components/monthly-recap/RecapShell.tsx`

```tsx
'use client'
import type { ReactNode } from 'react'

export function RecapShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-linear-to-br from-blue-50 to-indigo-100">
      <div className="mx-auto w-full max-w-sm flex-1 px-4 py-6">{children}</div>
    </div>
  )
}
```

### `components/monthly-recap/RecapProgressFrieze.tsx`

```tsx
'use client'
import type { RecapStep } from '@/lib/recap'

const STEPS_DISPLAY: ReadonlyArray<{ step: RecapStep, label: string }> = [
  { step: 'welcome', label: 'Bienvenue' },
  { step: 'summary', label: 'Récap' },
  { step: 'manage_bilan', label: 'Bilan' },
  { step: 'salary_update', label: 'Salaire' },
  { step: 'final_recap', label: 'Final' },
]

export function RecapProgressFrieze({ currentStep }: { currentStep: RecapStep }) {
  const currentIdx = STEPS_DISPLAY.findIndex(s => s.step === currentStep)
  return (
    <div className="mb-6 flex items-center justify-between">
      {STEPS_DISPLAY.map((s, i) => (
        <div key={s.step} className="flex flex-1 items-center">
          <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${i <= currentIdx ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>{i + 1}</div>
          {i < STEPS_DISPLAY.length - 1 && <div className={`mx-1 h-0.5 flex-1 ${i < currentIdx ? 'bg-blue-600' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  )
}
```

### `components/monthly-recap/GroupLockScreen.tsx`

```tsx
'use client'
import { useLogoutAndRedirect } from '@/hooks/useAuth'  // existing
import { Button } from '@/components/ui/button'

export function GroupLockScreen({ startedByName }: { startedByName: string | undefined }) {
  const logout = useLogoutAndRedirect()
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Récap en cours</h1>
      <p className="mb-8 text-sm text-gray-700">
        {startedByName ? `${startedByName} est en train` : 'Un membre du groupe est en train'} de réaliser le récap mensuel du groupe.
      </p>
      <p className="mb-8 text-sm text-gray-700">Vous pourrez accéder au groupe une fois le récap terminé.</p>
      <Button onClick={() => logout()} variant="secondary">Se déconnecter</Button>
    </div>
  )
}
```

### `hooks/useMonthlyRecap.ts`

```tsx
'use client'
import { useQuery } from '@tanstack/react-query'
import type { RecapContext, RecapStatusKind } from '@/lib/recap'
import type { RecapSummary } from '@/lib/recap/types'

export function useMonthlyRecap(context: RecapContext) {
  return useQuery({
    queryKey: ['monthly-recap', 'status', context],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/monthly-recap/status?context=${context}`, { signal })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'fetch_status_failed')
      }
      const json = await res.json()
      return json.data as { status: RecapStatusKind, summary: RecapSummary | null }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}
```

### `components/monthly-recap/RecapWizard.tsx`

```tsx
'use client'
import { useMonthlyRecap } from '@/hooks/useMonthlyRecap'
import { RecapShell } from './RecapShell'
import { RecapProgressFrieze } from './RecapProgressFrieze'
import { GroupLockScreen } from './GroupLockScreen'
import { WelcomeStep } from './steps/WelcomeStep'      // sous-tâche 11
import { SummaryStep } from './steps/SummaryStep'      // sous-tâche 11
import { BilanPositiveStep } from './steps/BilanPositiveStep'  // sous-tâche 12
import { BilanNegativeStep } from './steps/BilanNegativeStep'  // sous-tâche 12
import { SalaryUpdateStep } from './steps/SalaryUpdateStep'    // sous-tâche 13
import { FinalRecapStep } from './steps/FinalRecapStep'        // sous-tâche 13

export function RecapWizard({ context }: { context: 'profile' | 'group' }) {
  const { data, isLoading, error } = useMonthlyRecap(context)

  if (isLoading) return <RecapShell><LoadingPlaceholder /></RecapShell>
  if (error) return <RecapShell><ErrorPlaceholder error={error.message} /></RecapShell>
  if (!data) return null

  // Lock screen pour autre membre groupe
  if (data.status.kind === 'locked_by_other') {
    return <RecapShell><GroupLockScreen startedByName={data.status.startedByName} /></RecapShell>
  }

  // No recap row → screen 1 (welcome) — l'API start sera appelé au click "Commencer"
  if (data.status.kind === 'no_recap') {
    return (
      <RecapShell>
        <RecapProgressFrieze currentStep="welcome" />
        <WelcomeStep context={context} />
      </RecapShell>
    )
  }

  // Completed → redirect handled by proxy, mais filet ici
  if (data.status.kind === 'completed') {
    // router.replace handled in useEffect of completion handler — voir 13
    return <RecapShell><p>Récap déjà terminé, redirection…</p></RecapShell>
  }

  // in_progress : route sur le step
  const { step } = data.status
  const summary = data.summary!  // garanti non-null pour in_progress
  return (
    <RecapShell>
      <RecapProgressFrieze currentStep={step} />
      {step === 'welcome' && <WelcomeStep context={context} />}
      {step === 'summary' && <SummaryStep context={context} summary={summary} />}
      {step === 'manage_bilan' && (
        summary.bilanSign === 'positive' || summary.bilanSign === 'zero'
          ? <BilanPositiveStep context={context} summary={summary} />
          : <BilanNegativeStep context={context} summary={summary} recapState={...} />
      )}
      {step === 'salary_update' && <SalaryUpdateStep context={context} summary={summary} />}
      {step === 'final_recap' && <FinalRecapStep context={context} summary={summary} />}
    </RecapShell>
  )
}
```

## Étapes d'implémentation suggérées
1. **Créer `RecapShell.tsx`** : layout plein-écran + container max-w-sm.
2. **Créer `RecapProgressFrieze.tsx`** : 5 étapes visuelles avec état actif/inactif.
3. **Créer `GroupLockScreen.tsx`** : message + bouton logout (réutiliser `useLogoutAndRedirect`).
4. **Créer `hooks/useMonthlyRecap.ts`** : TanStack Query wrapper sur /api/monthly-recap/status.
5. **Créer `components/monthly-recap/RecapWizard.tsx`** : host avec routing par step. Stubs pour les step components (Welcome, Summary, etc.) — ces composants seront créés en 11-13. Pour ce sprint, créer des PLACEHOLDERS minimes pour qu'on puisse compile/run (`<div>WelcomeStep TODO</div>`).
6. **Créer `app/monthly-recap/page.tsx`** : Suspense + RecapWizard mount avec context from query param.
7. **Smoke test** : `pnpm dev` → seed scenario fresh (via /dev/recap) → navigate /monthly-recap → voir Welcome placeholder + frise étape 1. Seed deficit-cascade-full → navigate → voir Summary placeholder + frise étape 2. Seed edge-locked-by-other → voir GroupLockScreen.
8. **Tests RTL** : 4 cas (RecapWizard rend correctement par kind), Frieze test indices, LockScreen test logout call.
9. **Commit** : `feat(recap): wizard shell + progress frieze + group lock screen`.

## Critères d'acceptation
- [ ] `components/monthly-recap/RecapShell.tsx` : layout mobile-first max-w-sm
- [ ] `RecapProgressFrieze.tsx` : 5 étapes, état visuel actif/inactif
- [ ] `GroupLockScreen.tsx` : message + bouton "Se déconnecter" qui call useLogoutAndRedirect
- [ ] `hooks/useMonthlyRecap.ts` : useQuery sur /api/monthly-recap/status, staleTime 30s
- [ ] `RecapWizard.tsx` : route correctement sur kind ('no_recap'→Welcome, 'in_progress'→step component, 'locked_by_other'→LockScreen, 'completed'→placeholder)
- [ ] `app/monthly-recap/page.tsx` : Suspense + context from query param
- [ ] Step components 11-13 stubbed avec placeholder div (pour permettre compile)
- [ ] Tests RTL : 4 cas WizardRouter + 2 cas LockScreen + 3 cas Frieze
- [ ] Smoke manuel : 3 scenarios différents → 3 écrans différents s'affichent correctement
- [ ] Aucun usage `router.push` (uniquement `router.replace` pour redirects post-completion)
- [ ] Aucune utilisation de `window.location.reload()` (cf. CLAUDE.md ❌ Modals & UI)
- [ ] Mobile-first OK : tester DevTools 430px max
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0

## Tests à écrire

### `components/monthly-recap/__tests__/RecapWizard.test.tsx` (RTL, jsdom)
- kind='no_recap' → render Welcome placeholder + Frieze step 1
- kind='in_progress' step='summary' → render Summary placeholder + Frieze step 2
- kind='in_progress' step='manage_bilan' summary.bilanSign='positive' → render BilanPositive placeholder
- kind='in_progress' step='manage_bilan' summary.bilanSign='negative' → render BilanNegative placeholder
- kind='locked_by_other' → render GroupLockScreen (not RecapShell content)
- kind='completed' → render placeholder "déjà terminé"

### `components/monthly-recap/__tests__/RecapProgressFrieze.test.tsx`
- currentStep='welcome' → step 1 actif, steps 2-5 inactif
- currentStep='salary_update' → steps 1-4 actif, step 5 inactif
- currentStep='completed' → tous actifs

### `components/monthly-recap/__tests__/GroupLockScreen.test.tsx`
- Render avec name → affiche "Alice est en train…"
- Render sans name → affiche "Un membre du groupe est en train…"
- Click logout button → useLogoutAndRedirect called

## Pièges et points d'attention
- **Pas de `router.push`** ailleurs qu'erreur réseau retry — utiliser `router.replace` pour post-completion (cf. CLAUDE.md `❌ router.push dans useLogin/useRequireGuest`).
- **`router.replace` côté useEffect** : si on doit redirect depuis l'UI (ex. completed → /dashboard), faire dans `useEffect(() => router.replace(...), [])` pour éviter render warning.
- **Step components placeholders** : OK pour ce sprint mais doivent être minimes (`<div>WelcomeStep TODO</div>`). Sous-tâches 11-13 les remplaceront.
- **GroupLockScreen + bouton Se déconnecter** : c'est la SEULE action possible. Pas de "retour" ni de "tenter de prendre la main". Si l'initiateur reste bloqué dans le recap pendant des jours, c'est un cas debug → utiliser /api/debug/recap/reset.
- **`useMonthlyRecap` doit gérer le retry** : par défaut TanStack Query retry 3× sur erreur. OK pour la status route. Mais NE PAS retry sur 409/410 errors (locked_by_other / already_completed) — configurer `retry: (failureCount, error) => failureCount < 3 && error.message !== 'locked_by_other'`.
- **Mobile-first viewport** : tester `width: 375px` (iPhone SE), `width: 430px` (iPhone Pro Max). Le content doit RESTER lisible sans scroll horizontal, sans débordement.
- **Frieze "label en dessous" ?** la spec dit "frise de progression" sans préciser format. Recommandation : 5 cercles numérotés (1-5) connectés par traits. Si label sous chaque cercle, attention overflow mobile — peut-être afficher juste le label de l'étape active.
- **Suspense fallback** : utiliser `<RecapShell>` comme container du fallback aussi (sinon le layout pop). Cf. pattern existing `/dashboard` page.
- **`hooks/useAuth.ts`** : déjà existant, exporte `useLogoutAndRedirect`. Le réutiliser, ne PAS réimplémenter.

## Commandes utiles
```bash
# RTL tests
pnpm test:run components/monthly-recap

# Smoke manuel (avec un scenario seedé)
pnpm dev
# Navigate to http://localhost:3000/dev/recap → seed → http://localhost:3000/monthly-recap?context=profile
```

## Definition of Done
- Tous les critères d'acceptation cochés
- 4 composants + 1 hook + 1 page créés
- Step components placeholders en place pour permettre compile
- ≥9 tests RTL passants
- Smoke manuel : 3 scenarios distincts → 3 écrans distincts (welcome, summary stub, lock screen)
- Mobile viewport 375px clean
- Commit `feat(recap): wizard shell + progress frieze + group lock screen`
- `pnpm verify` exit 0
