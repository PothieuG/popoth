# [12] — Screen 3A : Bilan positif (transfert surplus vers tirelire / savings)

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3 — écran 3A, quand bilan ≥ 0, user choisit Oui/Non sur transfert surplus vers tirelire, puis bouton qui transforme le reste en savings cumulées.
- Position dans la séquence : étape 12/17
- Dépend de : 06 (positive endpoints), 10 (wizard shell), 11 (Summary step)
- Débloque : 13 (SalaryUpdateStep — l'avancement de current_step se fait via transform-remaining-surpluses-to-savings)

## Objectif
Implémenter `BilanPositiveStep.tsx` avec la logique 4.A complète : partie indicative haut (surplus → savings preview), partie interactive bas (Oui/Non + drawer si Oui + bouton continuer). Gérer le re-render après transfert partiel (surplus restants seulement).

## Fichiers concernés
- `components/monthly-recap/steps/BilanPositiveStep.tsx` — à créer (remplace placeholder de 10)
- `components/monthly-recap/SurplusSelectionDrawer.tsx` — à créer (checkboxes par budget + bouton transférer)
- `hooks/useMonthlyRecap.ts` — à étendre avec `useTransferSurplusesToPiggy()` + `useTransformRemainingSurplusesToSavings()`
- `lib/recap/types.ts` — à LIRE (BudgetSummary)
- `components/ui/checkbox.tsx` — à LIRE (shadcn checkbox component)

## Patterns et conventions à respecter
- **Refetch après mutation** : après transfer-surpluses-to-piggy, le response inclut `summary` fresh → utilise pour re-render OR invalide query pour re-fetch. Recommandation : `qc.setQueryData(...)` avec le fresh summary du response (zero re-fetch overhead).
- **Drawer + checkbox state** : maintenu local au drawer, validé au click "Transférer".
- **Loading state per-action** : 2 mutations distinctes, disable buttons pendant pending.
- **Animation step** : si après transfert il reste 0 surplus, afficher "Plus de surplus disponible" + bouton "Continuer" → transition smooth.

## Détail du composant

```tsx
'use client'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { SurplusSelectionDrawer } from '../SurplusSelectionDrawer'
import { formatEuro } from '@/lib/format-currency'
import type { RecapSummary, BudgetSummary } from '@/lib/recap/types'

export function BilanPositiveStep({ context, summary }: { context: 'profile'|'group', summary: RecapSummary }) {
  const qc = useQueryClient()
  const [decided, setDecided] = useState<'yes' | 'no' | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const surplusBudgets = summary.budgets.filter(b => b.surplus > 0)
  const hasSurplus = surplusBudgets.length > 0

  // Mutation : transformer tous les surplus restants en savings
  const transformMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/monthly-recap/transform-remaining-surpluses-to-savings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error ?? 'transform_failed') }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monthly-recap', 'status', context] }),
    onError: (e) => setError((e as Error).message),
  })

  // Mutation : transfer surpluses sélectionnés vers piggy
  const transferMutation = useMutation({
    mutationFn: async (budgetIds: string[]) => {
      const res = await fetch('/api/monthly-recap/transfer-surpluses-to-piggy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, budgetIds }),
      })
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error ?? 'transfer_failed') }
      return res.json() as Promise<{ data: { transferred: Array<{ budgetId: string, amount: number }>, summary: RecapSummary } }>
    },
    onSuccess: (res) => {
      // Fresh summary du response → updateQueryData pour re-render immédiat
      qc.setQueryData(['monthly-recap', 'status', context], (old: any) => ({ ...old, summary: res.data.summary }))
      setDrawerOpen(false)
    },
    onError: (e) => setError((e as Error).message),
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Gestion du bilan positif</h1>

      {/* Partie indicative */}
      <section className="rounded-2xl border border-green-200 bg-green-50 p-4">
        <p className="mb-2 text-sm font-medium text-green-700">Récap transformation surplus → économies</p>
        {surplusBudgets.length === 0 ? (
          <p className="text-sm text-gray-700">Aucun surplus à transformer.</p>
        ) : (
          <ul className="space-y-1 text-sm text-gray-700">
            {surplusBudgets.map(b => (
              <li key={b.budgetId} className="flex justify-between">
                <span>{b.budgetName}</span>
                <span>+{formatEuro(b.cumulatedSavings + b.surplus)} (économies mois prochain)</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Partie interactive */}
      {hasSurplus && (
        <section>
          <p className="mb-3 text-sm font-medium text-gray-900">Voulez-vous ajouter un ou plusieurs surplus à la tirelire ?</p>
          {decided === null && (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setDecided('no')}>Non</Button>
              <Button variant="default" className="flex-1" onClick={() => { setDecided('yes'); setDrawerOpen(true) }}>Oui</Button>
            </div>
          )}

          {decided === 'no' && (
            <Button className="w-full" onClick={() => transformMutation.mutate()} disabled={transformMutation.isPending}>
              {transformMutation.isPending ? 'Transformation…' : 'Transformer tous les surplus en économies'}
            </Button>
          )}

          {decided === 'yes' && (
            <Button variant="link" onClick={() => setDrawerOpen(true)}>Sélectionner des surplus à transférer</Button>
          )}
        </section>
      )}

      {/* Bouton final après transferts partiels (refetch surplus restants) */}
      {decided === 'yes' && hasSurplus && !drawerOpen && (
        <Button className="w-full" onClick={() => transformMutation.mutate()} disabled={transformMutation.isPending}>
          Transformer les surplus restants en économies
        </Button>
      )}

      {/* Cas plus de surplus restants */}
      {decided === 'yes' && !hasSurplus && (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">Plus de surplus disponible.</p>
          <Button className="w-full" onClick={() => transformMutation.mutate()} disabled={transformMutation.isPending}>Continuer</Button>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <SurplusSelectionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        budgets={surplusBudgets}
        isSubmitting={transferMutation.isPending}
        onSubmit={(budgetIds) => transferMutation.mutate(budgetIds)}
      />
    </div>
  )
}
```

### `SurplusSelectionDrawer.tsx`

```tsx
'use client'
import { useState, useEffect } from 'react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { formatEuro } from '@/lib/format-currency'
import type { BudgetSummary } from '@/lib/recap/types'

export function SurplusSelectionDrawer({ open, onClose, budgets, isSubmitting, onSubmit }: {
  open: boolean
  onClose: () => void
  budgets: BudgetSummary[]
  isSubmitting: boolean
  onSubmit: (budgetIds: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setSelected(new Set())  // reset au mount
  }, [open])

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const totalSelected = budgets.filter(b => selected.has(b.budgetId)).reduce((s, b) => s + b.surplus, 0)

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Sélectionner les surplus à transférer</DrawerTitle>
          <ModalCloseX onClose={onClose} variant="circle" />
        </DrawerHeader>
        <div className="space-y-2 px-6 py-4">
          {budgets.map(b => (
            <label key={b.budgetId} className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <div className="flex items-center gap-3">
                <Checkbox checked={selected.has(b.budgetId)} onCheckedChange={() => toggle(b.budgetId)} aria-label={`Sélectionner ${b.budgetName}`} />
                <span className="text-sm">{b.budgetName}</span>
              </div>
              <span className="text-sm font-medium text-green-700">+{formatEuro(b.surplus)}</span>
            </label>
          ))}
        </div>
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
          <Button
            className="w-full"
            disabled={selected.size === 0 || isSubmitting}
            onClick={() => onSubmit(Array.from(selected))}
          >
            {isSubmitting ? 'Transfert…' : `Transférer ${formatEuro(totalSelected)} vers la tirelire`}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
```

## Étapes d'implémentation suggérées
1. **Vérifier `Checkbox` shadcn** : `Grep "components/ui/checkbox"` — si absent, ajouter via `pnpm dlx shadcn@latest add checkbox` ou créer manuellement (pattern Radix Checkbox).
2. **Créer `SurplusSelectionDrawer.tsx`** : drawer avec checkboxes + total selected + bouton transférer.
3. **Étendre `hooks/useMonthlyRecap.ts`** avec `useTransferSurplusesToPiggy()` + `useTransformRemainingSurplusesToSavings()` factorisés (optional refactor).
4. **Créer `BilanPositiveStep.tsx`** : section indicative + question Oui/Non + bouton continue/transform + drawer integration.
5. **Tests RTL** : 15+ cas couvrant les paths (no_surplus, decided=no→transform, decided=yes→drawer→partial transfer→reste→transform, decided=yes→drawer→full transfer→no surplus→continuer).
6. **Smoke manuel** : seed `happy-surplus-light` → /monthly-recap → Welcome → Summary → Étape suivante → BilanPositive → click Oui → drawer ouvre → cocher 1/3 → transférer → drawer ferme + 2 surplus restants → click "Transformer les surplus restants" → step avance vers salary_update.
7. **Commit** : `feat(recap): screen 3A bilan positive with surplus selection drawer`.

## Critères d'acceptation
- [ ] `BilanPositiveStep.tsx` : 3 états logiques (decided=null / decided=no / decided=yes)
- [ ] decided=no → bouton "Transformer tous les surplus en économies"
- [ ] decided=yes → drawer ouvre, checkbox par surplus budget, bouton "Transférer X€ vers la tirelire"
- [ ] Après transfer partial : drawer ferme, refresh summary, surplus restants affichés, bouton "Transformer les surplus restants en économies"
- [ ] Après transfer FULL : "Plus de surplus disponible" + bouton "Continuer"
- [ ] Click "Transformer" (any path) → POST /transform-remaining-surpluses-to-savings → invalidate → wizard route vers salary_update
- [ ] Total selected dans drawer mis à jour en temps réel (totalSelected = sum surplus des checked)
- [ ] Drawer reset selection au close/reopen
- [ ] Error UX si mutation fail
- [ ] Tests RTL ≥15 cas passants
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0

## Tests à écrire

### `BilanPositiveStep.test.tsx`
- Render avec 3 surplus → section indicative + question Oui/Non visible
- Render avec 0 surplus (cas bilan=zero) → "Aucun surplus à transformer" + bouton Continuer direct
- Click "Non" → bouton "Transformer tous" apparaît
- Click "Transformer tous" → POST /transform-remaining + loading state
- Click "Oui" → drawer ouvre
- Drawer transfer → fresh summary applied via setQueryData, drawer ferme
- Après transfer partial : bouton "Transformer les surplus restants" affiché
- Après transfer full : "Plus de surplus disponible" + Continuer
- Error fetch fail → message rouge

### `SurplusSelectionDrawer.test.tsx`
- Render avec 3 budgets → 3 checkboxes
- Toggle checkbox → state local updated, totalSelected = sum
- Click "Transférer" avec 0 selected → button disabled
- Click "Transférer" avec 2 selected → onSubmit([id1, id2])
- Loading state → button disabled + label "Transfert…"
- Reset selection au reopen drawer
- a11y axe pas de violations + ESC ferme drawer (Radix natif)

## Pièges et points d'attention
- **Fresh summary du response transfer** : utiliser `qc.setQueryData(key, {...old, summary: res.data.summary})` pour éviter une re-fetch. Plus rapide UX.
- **Decided=yes + drawer fermé sans transfer** : state local "decided" persiste. Si user ferme drawer sans transférer, le composant doit afficher "Sélectionner des surplus" link pour rouvrir.
- **Drawer reset selection** : crucial sinon des budgets décochés réapparaissent cochés au prochain open.
- **Section indicative affichage** : "Récap transformation" doit montrer `cumulated_savings + surplus = nouveau total économies mois prochain`. Pas juste le surplus seul.
- **Bouton "Transformer" final** : appelle `/transform-remaining-surpluses-to-savings` qui transforme TOUS les surplus restants (sans param). L'avancement step → 'salary_update' se fait côté serveur.
- **Cas bilan = 0** : techniquement aucun surplus, donc section indicative vide + bouton Continuer direct. Tester ce cas.
- **TanStack Query `setQueryData` callback** : la signature est `(old: T | undefined) => T`. Toujours guard `if (!old) return old`.
- **Bouton "Continuer"** vs **"Transformer tous"** : sémantiquement différents — le 2eme transforme les surplus restants, le 1er est un no-op qui avance step. Décision : utiliser `/transform-remaining-surpluses-to-savings` pour les 2 (l'endpoint est no-op safe avec 0 surplus).
- **DRY**: si les variants UI complexes deviennent confus, extraire en sous-components `PositiveQuestionBlock`, `PositiveContinueBlock`, etc.

## Commandes utiles
```bash
pnpm test:run components/monthly-recap/__tests__/BilanPositiveStep components/monthly-recap/__tests__/SurplusSelectionDrawer

# Smoke
pnpm dev
# /dev/recap → seed happy-surplus-large → /monthly-recap → suivre flow positif
```

## Definition of Done
- Tous les critères d'acceptation cochés
- 2 composants créés (BilanPositiveStep + SurplusSelectionDrawer)
- Mutations TanStack Query intégrées avec fresh summary refresh
- ≥15 tests RTL passants
- Smoke : path complet "Oui → partial transfer → reste → transformer" + path "Non → transformer tous"
- Commit `feat(recap): screen 3A bilan positive with surplus selection drawer`
- `pnpm verify` exit 0
