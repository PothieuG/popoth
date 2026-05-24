# [14] — Screens 4 & 5 : Salary update + Final recap (complete)

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3 — derniers écrans : mise à jour salaire(s) optionnelle + écran final récapitulatif + bouton "Retourner au dashboard" qui POST complete.
- Position dans la séquence : étape 14/17
- Dépend de : 08 (salary + finalize endpoints), 10 (wizard shell), 11-13 (steps précédents)
- Débloque : 17 (E2E tests testent le flow complet)

## Objectif
Implémenter `SalaryUpdateStep.tsx` (question Oui/Non + form perso 1 input ou form groupe N inputs membres + bouton Mettre à jour) et `FinalRecapStep.tsx` (résumé court + bouton "Retourner au dashboard" → POST complete + router.replace dashboard).

## Fichiers concernés
- `components/monthly-recap/steps/SalaryUpdateStep.tsx` — à créer
- `components/monthly-recap/steps/FinalRecapStep.tsx` — à créer
- `components/monthly-recap/GroupMemberSalaryForm.tsx` — à créer (subforme pour cas group)
- `components/monthly-recap/RecapSummaryActions.tsx` — à créer (résumé des actions effectuées pour écran 5)
- `hooks/useMonthlyRecap.ts` — à étendre avec `useUpdateSalaries()` + `useCompleteRecap()`
- `lib/api/group-members.ts` — à créer ou trouver helper existant (fetch group members liste)
- `app/api/groups/[id]/members/route.ts` — à LIRE pour comprendre comment fetch les membres

## Patterns et conventions à respecter
- **Code couleur UI Popoth** (à suivre autant que possible — vérifié sprint 13 follow-up 2026-05-24) :
  - **Tirelire** = violet (`bg-violet-50`, `border-violet-200`, `text-violet-800/900`)
  - **Économies des budgets** = violet (même famille que la tirelire)
  - **Budgets** = orange (`bg-orange-50/100`, `border-orange-200/300`, `text-orange-800/900`)
  - **Deficit** = red (compteur / sections déficit)
  - **Surplus / succès** = green (transformation positive, snackbar succès `bg-green-600`)
  - **Neutral / locked / done** = gray (cards greyed pour les étapes en attente ou terminées)
  Pour toute nouvelle surface, vérifier si une convention existante s'applique (cf. `BilanPositiveStep`, `BilanNegativeStep`, `RefloatPiggyLine`, `RefloatSavingsLine`, `RefloatBudgetSnapshotLine`, `SurplusSelectionDrawer`) avant de choisir une couleur.
- **`useForm` + `zodResolver`** : cf. [.claude/conventions/zod-patterns.md](../.claude/conventions/zod-patterns.md) §A Pattern dual-type. `useForm<FormInput, undefined, FormOutput>` + `<DecimalFormInput>` réutilisable pour les inputs salaire (decimal fr-FR comma→dot).
- **GroupMembersFetch** : fetcher la liste des membres pour pré-remplir le form group. Soit via une route existante `GET /api/groups/<id>/members`, soit en passant la liste depuis le summary endpoint (étendre loadRecapSummary).
- **router.replace post-complete** : `router.replace(context === 'group' ? '/group-dashboard' : '/dashboard')`. PAS `router.push` (cf. CLAUDE.md `❌ Auth + recap nav`).
- **Format CSS** : input numeric avec euro suffix, label clair, submit button full-width.

## Détail des composants

### `SalaryUpdateStep.tsx`

```tsx
'use client'
import { useState } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { DecimalFormInput } from '@/components/ui/decimal-form-input'
import { GroupMemberSalaryForm } from '../GroupMemberSalaryForm'

const profileFormSchema = z.object({ salary: z.coerce.number().nonnegative().finite() })
type ProfileFormInput = z.input<typeof profileFormSchema>
type ProfileFormOutput = z.output<typeof profileFormSchema>

export function SalaryUpdateStep({ context, summary, profile }: {
  context: 'profile'|'group'
  summary: RecapSummary
  profile: { id: string, salary: number, group_id: string | null }
}) {
  const qc = useQueryClient()
  const [decided, setDecided] = useState<'yes' | 'no' | null>(null)

  const advanceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/monthly-recap/advance-step', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, targetStep: 'final_recap' }),
      })
      if (!res.ok) throw new Error('advance_failed')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monthly-recap','status',context] }),
  })

  const updateMutation = useMutation({
    mutationFn: async (salaries: Array<{ profileId: string, salary: number }>) => {
      const res = await fetch('/api/monthly-recap/update-salaries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, salaries }),
      })
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error ?? 'update_failed') }
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monthly-recap','status',context] }),
  })

  // --- Form profile (1 input) ---
  const form = useForm<ProfileFormInput, undefined, ProfileFormOutput>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { salary: profile.salary },
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Mise à jour du salaire</h1>
      <p className="text-sm text-gray-700">
        {context === 'profile' ? 'Voulez-vous mettre à jour le salaire ?' : 'Voulez-vous mettre à jour un des salaires des membres du groupe ?'}
      </p>

      {decided === null && (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => { setDecided('no'); advanceMutation.mutate() }} disabled={advanceMutation.isPending}>Non</Button>
          <Button variant="default" className="flex-1" onClick={() => setDecided('yes')}>Oui</Button>
        </div>
      )}

      {decided === 'yes' && context === 'profile' && (
        <form onSubmit={form.handleSubmit((data) => updateMutation.mutate([{ profileId: profile.id, salary: data.salary }]))}>
          <label className="mb-2 block text-sm">Mon salaire</label>
          <DecimalFormInput {...form.register('salary')} aria-label="Salaire" suffix="€" />
          <Button type="submit" className="mt-4 w-full" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Mise à jour…' : 'Mettre à jour'}
          </Button>
        </form>
      )}

      {decided === 'yes' && context === 'group' && (
        <GroupMemberSalaryForm
          groupId={profile.group_id!}
          isSubmitting={updateMutation.isPending}
          onSubmit={(salaries) => updateMutation.mutate(salaries)}
        />
      )}
    </div>
  )
}
```

### `GroupMemberSalaryForm.tsx`

```tsx
'use client'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { DecimalFormInput } from '@/components/ui/decimal-form-input'

interface Member { id: string, first_name: string, last_name: string, salary: number }

const groupFormSchema = z.object({
  members: z.array(z.object({ profileId: z.string().uuid(), salary: z.coerce.number().nonnegative().finite() })),
})
type GroupFormInput = z.input<typeof groupFormSchema>
type GroupFormOutput = z.output<typeof groupFormSchema>

export function GroupMemberSalaryForm({ groupId, isSubmitting, onSubmit }: { groupId: string, isSubmitting: boolean, onSubmit: (data: Array<{ profileId: string, salary: number }>) => void }) {
  const { data: members, isLoading } = useQuery({
    queryKey: ['groups', groupId, 'members-with-salary'],
    queryFn: async () => {
      const res = await fetch(`/api/groups/${groupId}/members`)  // adapt to actual endpoint
      if (!res.ok) throw new Error('fetch_members_failed')
      const json = await res.json()
      return json.data as Member[]
    },
  })

  // form defaults from members fetched
  const form = useForm<GroupFormInput, undefined, GroupFormOutput>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: { members: [] },
  })

  // hydrate form once members loaded
  useEffect(() => {
    if (members) {
      form.reset({ members: members.map(m => ({ profileId: m.id, salary: m.salary })) })
    }
  }, [members, form])

  if (isLoading) return <p>Chargement membres…</p>
  if (!members) return <p>Erreur chargement membres.</p>

  return (
    <form onSubmit={form.handleSubmit((data) => onSubmit(data.members))} className="space-y-3">
      {members.map((m, idx) => (
        <div key={m.id}>
          <label className="mb-1 block text-sm">{m.first_name} {m.last_name}</label>
          <DecimalFormInput {...form.register(`members.${idx}.salary`)} aria-label={`Salaire ${m.first_name}`} suffix="€" />
        </div>
      ))}
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Mise à jour…' : 'Mettre à jour'}
      </Button>
    </form>
  )
}
```

### `FinalRecapStep.tsx`

```tsx
'use client'
import { useState } from 'react'
import { useMutation, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { formatEuro } from '@/lib/format-currency'

export function FinalRecapStep({ context, summary, recapState, profile }: {
  context: 'profile'|'group'
  summary: RecapSummary
  recapState: { id: string, refloated_from_piggy: number, refloated_from_savings: number, budget_snapshot_data: Record<string, number> }
  profile: { salary: number, contribution?: number }
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/monthly-recap/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error ?? 'complete_failed') }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['monthly-recap','status',context] })
      router.replace(context === 'group' ? '/group-dashboard' : '/dashboard')
    },
    onError: (e) => setError((e as Error).message),
  })

  // Synthese des actions effectuées (issue du recapState + summary)
  const positiveActions = summary.bilanSign === 'positive'
  const totalRefloated = recapState.refloated_from_piggy + recapState.refloated_from_savings + Object.values(recapState.budget_snapshot_data).reduce((s, v) => s + v, 0)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Récapitulatif final</h1>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 text-sm">
        {positiveActions && <p>Surplus total transformé en économies : <strong>+{formatEuro(summary.totalSurplus)}</strong></p>}
        {!positiveActions && totalRefloated > 0 && (
          <>
            <p>Renflouement total : {formatEuro(totalRefloated)}</p>
            {recapState.refloated_from_piggy > 0 && <p>• Via tirelire : {formatEuro(recapState.refloated_from_piggy)}</p>}
            {recapState.refloated_from_savings > 0 && <p>• Via économies : {formatEuro(recapState.refloated_from_savings)}</p>}
            {Object.keys(recapState.budget_snapshot_data).length > 0 && <p>• Via puisage budgets : {formatEuro(Object.values(recapState.budget_snapshot_data).reduce((s, v) => s + v, 0))}</p>}
          </>
        )}
        {profile.salary && <p>Salaire actuel : {formatEuro(profile.salary)}</p>}
        {profile.contribution !== undefined && <p>Contribution groupe : {formatEuro(profile.contribution)}</p>}
      </section>

      <Button className="w-full" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending}>
        {completeMutation.isPending ? 'Finalisation…' : 'Retourner au dashboard'}
      </Button>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
```

## Étapes d'implémentation suggérées
1. **Vérifier `DecimalFormInput`** existant ([components/ui/decimal-form-input.tsx](../components/ui/decimal-form-input.tsx)) — réutiliser tel quel.
2. **Vérifier endpoint membres groupe** : `GET /api/groups/[id]/members` ? Si pattern différent, adapter. Le response doit contenir `[{id, first_name, last_name, salary}]`.
3. **Créer `GroupMemberSalaryForm.tsx`** : useQuery fetch members + useForm dynamic array + hydrate on load.
4. **Créer `SalaryUpdateStep.tsx`** : Yes/No question + form perso (1 input) OR form groupe (delegate to subform).
5. **Créer `FinalRecapStep.tsx`** : résumé textuel des actions + bouton complete + router.replace.
6. **Étendre `useMonthlyRecap.ts`** : useUpdateSalaries + useCompleteRecap (utiles pour réutiliser via les step composants).
7. **Tests RTL** : ≥12 cas. Yes/No paths + form profile submit + form group fetch+submit + complete success+redirect + error UX.
8. **Smoke** : seed `group-deficit-3-members` → flow complet → écran 4 → modifier 3 salaires → check contributions recalculées en BD → écran 5 → "Retourner au dashboard" → redirect /group-dashboard.
9. **Commit** : `feat(recap): screens 4 & 5 salary update + final recap`.

## Critères d'acceptation
- [ ] `SalaryUpdateStep.tsx` : Yes/No question + 2 forms conditionnels (profile / group)
- [ ] Click "Non" → advance-step direct → wizard route vers final_recap
- [ ] Click "Oui" + profile → 1 input pré-rempli + submit → POST update-salaries → invalidate
- [ ] Click "Oui" + group → fetch members + N inputs pré-remplis + submit → POST update-salaries (array) → invalidate
- [ ] Form group : hydrate après fetch members, gérer loading state
- [ ] `FinalRecapStep.tsx` : résumé court adapté au parcours (positive / negative) + bouton "Retourner au dashboard"
- [ ] Click "Retourner au dashboard" → POST complete → router.replace
- [ ] Resume après complete : navigate /dashboard ne re-redirige PAS sur /monthly-recap (proxy gating cache cookie 5min OR status check returns completed)
- [ ] Error UX si update fail / complete fail
- [ ] Tests RTL ≥12 cas passants
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0
- [ ] Mobile viewport clean (forms scrollables si N membres groupe)

## Tests à écrire

### `SalaryUpdateStep.test.tsx`
- Render context=profile → "Voulez-vous mettre à jour le salaire ?"
- Render context=group → "Voulez-vous mettre à jour un des salaires des membres du groupe ?"
- Click "Non" → POST advance-step + invalidate cache
- Click "Oui" context=profile → form 1 input visible
- Submit form profile → POST update-salaries avec [{profileId, salary}]
- Click "Oui" context=group → GroupMemberSalaryForm rendered
- Loading state pendant submit

### `GroupMemberSalaryForm.test.tsx`
- Loading members → "Chargement membres…"
- Members loaded → N inputs avec defaults
- Submit → onSubmit avec array [{profileId, salary}] correct
- Validation Zod : input négatif → erreur

### `FinalRecapStep.test.tsx`
- Render bilan positive → message "Surplus transformé en économies +X€"
- Render bilan negative with refloats → liste détaillée (piggy/savings/snapshot)
- Click "Retourner au dashboard" → POST complete + router.replace called
- Error 410 alreadyCompleted → message UX (mais router.replace quand même)

## Pièges et points d'attention
- **`router.replace` post-complete** : pour éviter le retour back-button qui ramènerait sur le recap (cf. CLAUDE.md `❌ Auth + recap nav`).
- **`/api/groups/[id]/members` endpoint** : peut être inexistant ou avoir un format différent. Si absent, créer un endpoint dédié dans cette tâche OU étendre le status endpoint pour retourner les membres en cas context=group.
- **Form group hydration** : `form.reset(...)` après fetch members. Si les inputs sont rendus AVANT le reset, ils sont vides. Solution : ne render le form que `if (members)`, ou utiliser `defaultValues` async (RHF v7 supporte useForm defaultValues async).
- **DecimalFormInput**: gère le comma→dot fr-FR. Vérifier signature dans [components/ui/decimal-form-input.tsx](../components/ui/decimal-form-input.tsx). Probablement `<DecimalFormInput {...register('field')} />` + props spécifiques.
- **`profile.contribution`** : optional dans le résumé final. Calculer côté loadRecapSummary OR fetch séparé depuis group_contributions. Si manquant, ne pas afficher la ligne.
- **Complete idempotent** : si user clique 2× "Retourner au dashboard", le 2eme call retourne `alreadyCompleted: true` → router.replace OK aussi (pas d'erreur).
- **No back button** : sur l'écran 5, ne PAS afficher de bouton "Retour étape précédente" — la spec dit "le bouton retour est désactivé". Le wizard shell ne montre pas de back arrow.
- **Cas "Non" salary update suivi de "Oui" sur écran final ?** Non, écran 5 n'a pas de retour. Le user qui change d'avis doit accepter — c'est la spec.
- **Recalc contributions automatique** : géré côté server (08 endpoint). Le UI ne fait rien de spécial.

## Commandes utiles
```bash
pnpm test:run components/monthly-recap/__tests__/SalaryUpdateStep components/monthly-recap/__tests__/GroupMemberSalaryForm components/monthly-recap/__tests__/FinalRecapStep

# Smoke complet
pnpm dev → /dev/recap → seed group-deficit-3-members → /monthly-recap?context=group → flow complet
```

## Definition of Done
- Tous les critères d'acceptation cochés
- 4 composants créés (SalaryUpdateStep + GroupMemberSalaryForm + FinalRecapStep + éventuellement helper RecapSummaryActions)
- Flow complet end-to-end testable (seed → start → action → salary → complete → dashboard)
- ≥12 tests RTL passants
- Mobile viewport clean
- Commit `feat(recap): screens 4 & 5 salary update + final recap`
- `pnpm verify` exit 0
