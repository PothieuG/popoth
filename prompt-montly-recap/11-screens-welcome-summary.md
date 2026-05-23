# [11] — Screens 1 & 2 : Welcome + Summary avec drawers surplus / économies

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3 — premiers écrans du wizard.
- Position dans la séquence : étape 11/17
- Dépend de : 10 (wizard shell), 05 (start endpoint), 04 (calculations)
- Débloque : 12 (BilanPositive/Negative) car cliquer "Étape suivante" sur Summary route vers le manage_bilan step

## Objectif
Implémenter `WelcomeStep` (intro courte + bouton "Commencer" qui POST start et avance vers summary) et `SummaryStep` (4 cards récap + bloc bilan vert/rouge + 2 drawers indicatifs surplus/économies). Au click "Étape suivante" de SummaryStep, le step côté serveur reste 'summary' jusqu'à la première action sur l'écran suivant — OU on avance explicitement à 'manage_bilan' (décision : avancer explicitement avec un endpoint dédié `/api/monthly-recap/advance-step` OU laisser l'UI gérer un state local et l'endpoint suivant avance — voir Pièges).

## Fichiers concernés
- `components/monthly-recap/steps/WelcomeStep.tsx` — à créer (remplace le placeholder de 10)
- `components/monthly-recap/steps/SummaryStep.tsx` — à créer (remplace le placeholder de 10)
- `components/monthly-recap/SurplusDetailDrawer.tsx` — à créer (drawer indicatif liste surplus par budget)
- `components/monthly-recap/SavingsDetailDrawer.tsx` — à créer (drawer indicatif liste piggy + savings par budget)
- `components/monthly-recap/BilanBlock.tsx` — à créer (bloc bilan vert/rouge + message)
- `components/ui/drawer.tsx` — à LIRE pour patterns shadcn Drawer (déjà existant ?)
- `hooks/useMonthlyRecap.ts` — à étendre avec `useStartRecap()` (POST /start mutation)

## Patterns et conventions à respecter
- **Drawer Radix** : utiliser le pattern existing (cf. CLAUDE.md `DRAWER_CONTENT_CLASSES` + `<ModalCloseX>` + `tw-animate-css`). Cherche un drawer existant dans `components/dashboard/` ou `components/groups/` pour copier le pattern.
- **TanStack Query mutation** : `useMutation` avec `onSuccess` qui invalide `['monthly-recap', 'status', context]` pour re-fetch.
- **Loading buttons** : disable pendant submit + spinner inline. Pattern existing (`<Button disabled={isPending}>...</Button>`).
- **Color theming bilan** : vert = `text-green-700 bg-green-50 border-green-200`, rouge = `text-red-700 bg-red-50 border-red-200`, zéro = neutre.
- **Format currency** : utiliser `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })`. Helper existing ? Vérifier `lib/format-currency.ts` ou similaire (sinon créer un helper).
- **a11y** : `role="alert"` sur erreurs, `aria-label` sur boutons icon-only, focus trap géré par Radix Dialog automatiquement.

## Détail des composants

### `WelcomeStep.tsx`

```tsx
'use client'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import type { RecapContext } from '@/lib/recap'

export function WelcomeStep({ context }: { context: RecapContext }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/monthly-recap/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'start_failed')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['monthly-recap', 'status', context] })
    },
    onError: (e) => setError(e.message),
  })

  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="mb-3 text-xl font-semibold text-gray-900">Récap mensuel</h1>
      <p className="mb-2 text-sm text-gray-700">Bienvenue dans le récap mensuel du mois écoulé.</p>
      <p className="mb-8 text-sm text-gray-700">Tu vas pouvoir faire le point sur tes budgets, gérer tes surplus ou déficits, et finaliser le mois avant de retourner à ton dashboard.</p>
      <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending} className="w-full">
        {startMutation.isPending ? 'Démarrage…' : 'Commencer'}
      </Button>
      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error === 'locked_by_other' ? 'Un autre membre est déjà en train de faire le récap.' : error}</p>}
    </div>
  )
}
```

### `SummaryStep.tsx`

```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BilanBlock } from '../BilanBlock'
import { SurplusDetailDrawer } from '../SurplusDetailDrawer'
import { SavingsDetailDrawer } from '../SavingsDetailDrawer'
import { formatEuro } from '@/lib/format-currency'  // à créer si absent
import type { RecapSummary } from '@/lib/recap/types'

export function SummaryStep({ context, summary }: { context: 'profile'|'group', summary: RecapSummary }) {
  const [surplusOpen, setSurplusOpen] = useState(false)
  const [savingsOpen, setSavingsOpen] = useState(false)
  // ... mutation pour avancer step manage_bilan

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Récapitulatif</h1>

      <Card>
        <Label>Solde actuel</Label>
        <Amount>{formatEuro(summary.currentBalance)}</Amount>
      </Card>

      <Card>
        <Label>Reste à vivre estimé</Label>
        <Amount>{formatEuro(summary.ravEstime)}</Amount>
      </Card>

      <Card>
        <Label>Reste à vivre effectif</Label>
        <Amount>{formatEuro(summary.ravEffectif)}</Amount>
      </Card>

      <Card>
        <Label>Surplus total budgets</Label>
        <Amount>{formatEuro(summary.totalSurplus)}</Amount>
        <Button variant="link" onClick={() => setSurplusOpen(true)}>Voir le détail</Button>
      </Card>

      <Card>
        <Label>Total économies</Label>
        <Amount>{formatEuro(summary.totalSavings + summary.piggyAmount)}</Amount>
        <Button variant="link" onClick={() => setSavingsOpen(true)}>Voir le détail</Button>
      </Card>

      <BilanBlock bilan={summary.bilan} bilanSign={summary.bilanSign} />

      <Button className="w-full" onClick={advanceToManageBilan}>Étape suivante</Button>

      <SurplusDetailDrawer open={surplusOpen} onClose={() => setSurplusOpen(false)} budgets={summary.budgets.filter(b => b.surplus > 0)} />
      <SavingsDetailDrawer open={savingsOpen} onClose={() => setSavingsOpen(false)} piggyAmount={summary.piggyAmount} budgets={summary.budgets.filter(b => b.cumulatedSavings > 0)} />
    </div>
  )
}
```

### `BilanBlock.tsx`

```tsx
import { formatEuro } from '@/lib/format-currency'

export function BilanBlock({ bilan, bilanSign }: { bilan: number, bilanSign: 'positive'|'negative'|'zero' }) {
  const bgClass = bilanSign === 'positive' ? 'bg-green-50 border-green-200 text-green-700'
    : bilanSign === 'negative' ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-gray-50 border-gray-200 text-gray-700'

  return (
    <div className={`rounded-2xl border p-4 ${bgClass}`}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide">Bilan du mois</p>
      <p className="mb-3 text-2xl font-bold">{formatEuro(bilan)}</p>
      {bilanSign === 'positive' && <p className="text-sm">Vous allez pouvoir ajouter {formatEuro(bilan)} à votre total d'économies.</p>}
      {bilanSign === 'negative' && <p className="text-sm">L'objectif est de revenir à l'équilibre (bilan = 0).</p>}
      {bilanSign === 'zero' && <p className="text-sm">Le mois est équilibré. Passez à l'étape suivante.</p>}
    </div>
  )
}
```

### `SurplusDetailDrawer.tsx` + `SavingsDetailDrawer.tsx`

Drawer Radix purement indicatif : liste de budgets avec nom + amount, scrollable, bouton "Fermer". Aucune action.

```tsx
'use client'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { ModalCloseX } from '@/components/ui/modal-close-x'

export function SurplusDetailDrawer({ open, onClose, budgets }: { open: boolean, onClose: () => void, budgets: BudgetSummary[] }) {
  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Surplus par budget</DrawerTitle>
          <ModalCloseX onClose={onClose} variant="circle" />
        </DrawerHeader>
        <div className="space-y-2 px-6 py-4">
          {budgets.length === 0 && <p className="text-sm text-gray-500">Aucun surplus.</p>}
          {budgets.map(b => (
            <div key={b.budgetId} className="flex justify-between text-sm">
              <span>{b.budgetName}</span>
              <span className="font-medium text-green-700">+{formatEuro(b.surplus)}</span>
            </div>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
```

## Étapes d'implémentation suggérées
1. **Vérifier `formatEuro` exists** : `Grep "formatEuro|formatCurrency" lib/`. Si absent, créer `lib/format-currency.ts` avec `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })`.
2. **Vérifier `ModalCloseX` + `DRAWER_CONTENT_CLASSES`** : déjà existants, cf. CLAUDE.md §6.
3. **Créer `BilanBlock.tsx`** : pur composant présentationnel.
4. **Créer `SurplusDetailDrawer.tsx` + `SavingsDetailDrawer.tsx`** : Drawer Radix indicatif (no actions).
5. **Créer `WelcomeStep.tsx`** : useMutation pour POST /start + invalidation cache.
6. **Décision step transition Summary → manage_bilan** :
   - Option A : créer endpoint `POST /api/monthly-recap/advance-step` qui passe current_step à 'manage_bilan' (côté serveur, valide la transition).
   - Option B : laisser SummaryStep gérer en state local + advanced via le 1er endpoint suivant (transfer-surpluses-to-piggy ou refloat-from-piggy ou skip).
   - **Recommandation** : Option A pour propreté state machine (chaque transition explicite côté serveur). L'endpoint advance-step est simple, validate just `summary → manage_bilan`. Ajouter l'endpoint dans cette sous-tâche.
7. **Créer endpoint `POST /api/monthly-recap/advance-step`** : valide step transition, UPDATE current_step.
8. **Créer `SummaryStep.tsx`** : render 5 cards + bilan block + 2 drawers + bouton "Étape suivante" (mutation advance-step).
9. **Tests RTL** : WelcomeStep (mutation + error), SummaryStep (5 cards display + drawer open/close + advance), BilanBlock (3 variants), Drawers (display + close).
10. **Smoke manuel** : seed scenario `happy-surplus-light` → /monthly-recap → Welcome → click "Commencer" → Summary affiche bilan + cards → click drawer "Voir le détail" → drawer ouvre.
11. **Commit** : `feat(recap): welcome + summary screens with bilan block + indicative drawers`.

## Critères d'acceptation
- [ ] WelcomeStep affiche intro + bouton "Commencer", click → POST start + invalidate cache
- [ ] WelcomeStep gère erreur 'locked_by_other' avec message UX clair
- [ ] SummaryStep affiche 5 cards (solde, RAV estimé, RAV effectif, surplus total, total économies)
- [ ] SummaryStep affiche BilanBlock avec variant vert/rouge/neutre selon bilanSign
- [ ] 2 drawers indicatifs : SurplusDetail (liste budgets avec surplus > 0) + SavingsDetail (piggy + budgets avec cumulated_savings > 0)
- [ ] Drawers ouvrent/ferment via état local + bouton ModalCloseX
- [ ] Bouton "Étape suivante" → POST /advance-step → invalidate cache → wizard re-route sur manage_bilan
- [ ] Endpoint /advance-step créé, valide transition summary→manage_bilan strictement
- [ ] formatEuro helper utilisé partout pour les montants
- [ ] Mobile viewport 430px clean (pas de débordement)
- [ ] Tests RTL ≥12 cas passants
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0

## Tests à écrire

### `WelcomeStep.test.tsx` (RTL, jsdom)
- Render → "Récap mensuel" + bouton "Commencer"
- Click "Commencer" → fetch POST /api/monthly-recap/start avec body { context }
- Success → invalidate query
- Error 409 locked_by_other → affiche message "Un autre membre…"
- Loading → bouton disabled + label "Démarrage…"

### `SummaryStep.test.tsx`
- Render summary positive bilan → 5 cards visibles + BilanBlock vert + "+{bilan} à votre total"
- Render summary negative bilan → BilanBlock rouge + "objectif équilibre"
- Click "Voir le détail" surplus → drawer ouvre, liste budgets
- Click close drawer → drawer ferme
- Click "Étape suivante" → POST /advance-step + invalidate

### `BilanBlock.test.tsx`
- bilanSign='positive' → bg vert, message "ajouter à économies"
- bilanSign='negative' → bg rouge, message "objectif équilibre"
- bilanSign='zero' → bg neutre, message "équilibré"

### `SurplusDetailDrawer.test.tsx` + `SavingsDetailDrawer.test.tsx`
- Render avec budgets liste → chaque budget affiché avec nom + montant
- Render avec liste vide → "Aucun surplus."
- ESC ferme le drawer (Radix natif)
- a11y axe pas de violations

## Pièges et points d'attention
- **`router.replace` vs invalidate cache** : ne PAS faire de `router.push('/monthly-recap?context=profile&step=summary')` — la navigation reste sur `/monthly-recap?context=X` et le wizard router (10) re-render sur le bon step après invalidate.
- **Drawer ne doit PAS auto-fermer après une action** ici — c'est purement indicatif. Bouton "Fermer" explicite.
- **`formatEuro` helper** : si absent du codebase, créer `lib/format-currency.ts` avec `export const formatEuro = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)`. Trim aux 2 decimals.
- **TotalEconomies affichage** : `summary.totalSavings + summary.piggyAmount` (la spec section 4 dit "total des économies" = piggy + budgets cumulated_savings).
- **`advance-step` endpoint** : ne PAS oublier de valider que le user est initiator (started_by) + current_step était bien 'summary'. Sinon 403/409.
- **Step transition 'summary' → 'manage_bilan'** : peut se faire AUTOMATIQUEMENT au mount de SummaryStep ? Non — la spec dit "click Étape suivante" donc explicit action.
- **Cas summary mais bilan='zero'** : la route `manage_bilan` doit gérer ce cas. Si bilan = 0 exact, BilanBlock affiche neutre, et au clic "Étape suivante", on saute le manage_bilan logique-side mais l'UI montre quand même quelques infos. Décision : passer par manage_bilan, l'UI BilanPositiveStep avec totalSurplus=0 affiche "Aucun surplus à transformer, continue".
- **Hook `useStartRecap` reuse** : si plusieurs steps doivent invalider la même queryKey, factoriser dans `hooks/useMonthlyRecap.ts` (export useStartRecap + useAdvanceStep + ...).
- **DRY drawers** : SurplusDetailDrawer et SavingsDetailDrawer ont la même structure. Si flemme, factoriser dans un `RecapIndicativeDrawer` générique avec props. Ne pas sur-générique pour V1.

## Commandes utiles
```bash
pnpm test:run components/monthly-recap/__tests__/WelcomeStep components/monthly-recap/__tests__/SummaryStep components/monthly-recap/__tests__/BilanBlock components/monthly-recap/__tests__/SurplusDetailDrawer components/monthly-recap/__tests__/SavingsDetailDrawer

# Smoke
pnpm dev
# Navigate /dev/recap → seed happy-surplus-light → /monthly-recap?context=profile
```

## Definition of Done
- Tous les critères d'acceptation cochés
- 5 composants + 1 endpoint advance-step créés (+ format-currency helper si absent)
- ≥12 tests RTL passants
- Smoke : seed positif + négatif + zero, navigate, vérifier les 3 variants de BilanBlock
- Mobile viewport clean
- Commit `feat(recap): welcome + summary screens with bilan block + indicative drawers + advance-step endpoint`
- `pnpm verify` exit 0
