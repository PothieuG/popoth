# [09] — Dev scenarios extension + reset routes pour test rapide

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3 — faciliter le déclenchement manuel et le test des différents états du recap (spec section 8.3).
- Position dans la séquence : étape 09/17 (placée tôt — entre serveur et UI — pour permettre test endpoints via curl ou DevToolsClient avant build UI).
- Dépend de : 02 (migrations), 05 (start endpoint), 06 (positive), 07 (negative), 08 (finalize)
- Débloque : 16 (tests E2E peuvent réutiliser ces scénarios), test manuel rapide pendant 10-13 (UI)

## Objectif
Recréer les dev tools supprimés en 01 (`/dev/recap` + `/api/debug/recap/{reset,scenarios,seed}`) avec 20+ scénarios couvrant tous les parcours possibles (positive léger/lourd, deficit piggy-only, deficit cascade complète, group multi-membre, resume-mid-flow, transactions mixtes validated/non-validated, carry-over post-recap, etc.). Reset doit nettoyer monthly_recaps + reset is_carried_over flags + reset transactions.

## Fichiers concernés
- `lib/dev/recap-scenarios.ts` — à créer (remplace l'ancien recap-v2-scenarios.ts supprimé en 01)
- `lib/dev/apply-scenario.ts` — à créer (server-only apply logic)
- `app/api/debug/recap/scenarios/route.ts` — à créer (GET liste)
- `app/api/debug/recap/seed/route.ts` — à créer (POST { scenarioKey })
- `app/api/debug/recap/reset/route.ts` — à créer (POST { context }) — clean DB pour ce user/group
- `app/dev/recap/page.tsx` — à créer (gated NODE_ENV)
- `app/dev/recap/DevRecapClient.tsx` — à créer (UI client)
- `lib/api/block-in-production.ts` — à LIRE (helper existant pour gating debug)
- `lib/dev/recap-v2-scenarios.ts` (supprimé en 01) — référence dans git history pour structure

## Patterns et conventions à respecter
- **Toutes les routes debug** : `blockInProduction()` en première instruction (cf. CLAUDE.md §6 API).
- **Auth requise** : `validateSessionToken(request)` après blockInProduction (sinon n'importe qui peut seed en dev).
- **Scenarios déclaratifs** : reprendre le pattern de l'ancien `lib/dev/recap-v2-scenarios.ts` (export typed array of Scenario objects with key + label + description + setup).
- **Atomic apply** : `apply-scenario.ts` insère/upsert en cascade (profile cleanup → budgets → expenses → incomes → piggy → bank). Cleanup d'abord (DELETE recap row + DELETE expenses du mois + reset piggy/bank).
- **Server-only apply** : `lib/dev/apply-scenario.ts` importe `supabaseServer` → ne PAS importer côté browser. `lib/dev/recap-scenarios.ts` est edge-safe (juste les types + array).

## 20+ scénarios cibles

```ts
// lib/dev/recap-scenarios.ts (extrait)
export type ScenarioKey =
  // Positive
  | 'fresh-no-budgets'             // 0 budgets, 0 expenses (skip directement)
  | 'happy-surplus-light'          // 3 budgets, surplus léger ~150€ total
  | 'happy-surplus-large'          // 5 budgets, surplus large ~800€ total
  | 'surplus-with-existing-savings'  // surplus + cumulated_savings preexistantes (test transformation additive)

  // Deficit piggy-only (resolves in line 1)
  | 'deficit-tiny-piggy-covers'    // deficit 20€, piggy 100€ → piggy seule suffit, surplus residuel
  | 'deficit-large-piggy-exact'    // deficit 200€, piggy 200€ → piggy exactement

  // Deficit piggy + savings (lines 1+2)
  | 'deficit-medium-cascade-savings'  // deficit 150€, piggy 50€, savings total 200€ proportional
  | 'deficit-piggy-empty-savings-suffice'  // piggy=0, savings 300€ → savings seule suffit
  | 'deficit-savings-pool-equal-deficit'   // savings pool == deficit (clean cascade)

  // Deficit piggy + savings + budget snapshot (full cascade)
  | 'deficit-cascade-full'         // deficit 500€, piggy 100€, savings 100€ → reste 300€ via snapshot
  | 'deficit-cascade-savings-empty-budgets-only'  // piggy=0, savings=0 → all via budget snapshot
  | 'deficit-cascade-extreme'      // deficit énorme 2000€, force user à puiser sur tous les budgets

  // Group context
  | 'group-positive-2-members'     // groupe 2 membres, bilan positif
  | 'group-deficit-3-members'      // groupe 3 membres, bilan négatif → test salary update screen avec 3 inputs
  | 'group-mixed-salaries'         // groupe 2 membres avec salaires différents → test recalc contributions

  // Resume mid-flow
  | 'resume-at-summary'            // monthly_recaps row déjà créée, current_step='summary'
  | 'resume-at-manage-bilan-positive'  // current_step='manage_bilan', bilan positif
  | 'resume-at-manage-bilan-negative-half'  // current_step='manage_bilan', refloated_from_piggy=50€, deficit restant
  | 'resume-at-salary-update'      // current_step='salary_update'
  | 'resume-at-final-recap'        // current_step='final_recap'

  // Transactions mix
  | 'transactions-mixed-validated' // 10 expenses (6 applied, 4 non-applied) + 3 incomes (2 applied, 1 non-applied)
  | 'transactions-all-validated'   // toutes applied (will be DELETED on complete)
  | 'transactions-all-non-validated'  // toutes non-applied (will be carried-over)

  // Edge cases
  | 'edge-empty-piggy-surplus-zero'    // tout à 0
  | 'edge-balance-exact-zero'      // bilan = 0 exactement → bilanSign='zero'
  | 'edge-already-completed'       // recap déjà completed_at != null pour ce mois → test redirect dashboard
  | 'edge-locked-by-other'         // recap created by AUTRE member groupe (force lock pour user)
```

Total : ~25 scénarios. Structure de chaque scenario suit le pattern de l'ancien fichier (budgets array + expenses array + incomes array + realIncomes + piggy + bank + group? + recapState?).

## Détail des routes

### `app/api/debug/recap/scenarios/route.ts`

```ts
import { blockInProduction } from '@/lib/api/block-in-production'
import { withAuth } from '@/lib/api/with-auth'
import { listScenarios } from '@/lib/dev/recap-scenarios'

export const GET = withAuth(async () => {
  const blocked = blockInProduction(); if (blocked) return blocked
  return NextResponse.json({ data: listScenarios() })
})
```

### `app/api/debug/recap/seed/route.ts`

```ts
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  const blocked = blockInProduction(); if (blocked) return blocked
  const { scenarioKey } = await parseBody(request, z.object({ scenarioKey: z.string() }))
  const scenario = getScenario(scenarioKey as ScenarioKey)
  if (!scenario) return NextResponse.json({ error: 'unknown_scenario' }, { status: 404 })

  try {
    const result = await applyScenario(scenario, { userId, profileId: profile.id, groupId: profile.group_id })
    return NextResponse.json({ data: result })
  } catch (e) {
    logger.error('[debug/recap/seed] failed', e)
    return NextResponse.json({ error: '...' }, { status: 500 })
  }
})
```

### `app/api/debug/recap/reset/route.ts`

```ts
// POST { context: 'profile'|'group' } — clean state pour CE user (et groupe si demandé)
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  const blocked = blockInProduction(); if (blocked) return blocked
  const { context } = await parseBody(request, z.object({ context: contextSchema }))

  const filter = context === 'profile' ? { profile_id: profile.id } : { group_id: profile.group_id }
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  // 1. DELETE monthly_recaps row pour mois courant
  await supabaseServer.from('monthly_recaps').delete().match({ ...filter, recap_month: month, recap_year: year })

  // 2. Reset is_carried_over flags
  await supabaseServer.from('real_expenses').update({ is_carried_over: false, carried_from_recap_id: null }).match(filter).eq('is_carried_over', true)
  await supabaseServer.from('real_income_entries').update({ is_carried_over: false, carried_from_recap_id: null }).match(filter).eq('is_carried_over', true)

  // 3. Optional : reset applied_to_balance_at (utile pour re-tester un mois "neuf")
  //    NE PAS le faire par défaut — la spec scenario peut choisir explicitement.

  return NextResponse.json({ data: { reset: true, deleted_recap_for: `${month}/${year}` } })
})
```

### `app/dev/recap/page.tsx` + `DevRecapClient.tsx`

```ts
// page.tsx — server component
import { notFound } from 'next/navigation'

export default function DevRecapPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <DevRecapClient />
}

// DevRecapClient.tsx — pattern similaire à l'ancien DevRecapV2Client (216 LOC)
// - Fetch /api/debug/recap/scenarios → render list
// - 2 reset buttons (profile / group)
// - Picker pour seed un scenario + link vers /monthly-recap?context=...
// - Display result of seed/reset
```

### `lib/dev/apply-scenario.ts` — orchestrateur

```ts
import { supabaseServer } from '@/lib/supabase-server'
import type { Scenario, ScenarioSetup } from './recap-scenarios'

export async function applyScenario(scenario: Scenario, ctx: { userId: string, profileId: string, groupId: string | null }) {
  // 1. Cleanup état actuel : DELETE monthly_recaps, DELETE expenses/incomes du mois, reset piggy/bank
  // 2. UPSERT/INSERT budgets, expenses, incomes, piggy, bank selon le scenario
  // 3. Si scenario.group : créer/joindre groupe si nécessaire, insert group budgets/expenses
  // 4. Si scenario.recapState : créer monthly_recaps row avec current_step, started_by, snapshot_data, refloated_*
  // 5. Retourner summary { budgets_created, expenses_created, ... }
}
```

## Étapes d'implémentation suggérées
1. **Créer `lib/dev/recap-scenarios.ts`** : 25+ scenarios déclaratifs typés. Inspiration : l'ancien fichier (cf. git log).
2. **Créer `lib/dev/apply-scenario.ts`** : orchestrateur server-only. Cleanup phase + insert phase + recap state phase. Réutiliser les helpers Supabase existants.
3. **Créer les 3 routes debug** : scenarios (GET), seed (POST), reset (POST). Toutes avec `blockInProduction()`.
4. **Créer `app/dev/recap/page.tsx`** : server component gated NODE_ENV.
5. **Créer `app/dev/recap/DevRecapClient.tsx`** : client component avec UI minimaliste (reset buttons + scenario list + seed + link to /monthly-recap).
6. **Tests** : ce n'est PAS une feature prod, donc tests légers — juste smoke tests sur 2-3 scenarios pour vérifier qu'`applyScenario` ne crash pas. Pas de tests RTL ni gated.
7. **Smoke manuel** : `pnpm dev` → `/dev/recap` → seed `happy-surplus-light` → naviguer `/monthly-recap?context=profile` → vérifier que les budgets/expenses sont seedés.
8. **Commit** : `feat(recap): dev tools + 25 scenarios for testing`.

## Critères d'acceptation
- [ ] `lib/dev/recap-scenarios.ts` exporte ≥20 scenarios avec keys distinctes
- [ ] Au minimum un scenario par categorie : positive (4), deficit piggy-only (2), deficit cascade (3), full cascade (3), group (3), resume (5), transactions (3), edge (4)
- [ ] `lib/dev/apply-scenario.ts` orchestre cleanup + seed atomically
- [ ] Les 3 routes debug créées, `blockInProduction()` en première instruction, auth requise après
- [ ] `/dev/recap` accessible en dev, 404 en prod
- [ ] DevRecapClient affiche la liste scenarios + boutons reset + scénario picker + link to recap page
- [ ] Reset route DELETE monthly_recaps row du mois + reset is_carried_over flags
- [ ] Smoke test : seed 3-4 scenarios différents, naviguer recap, vérifier visuellement le state attendu
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0
- [ ] Aucun import server-only dans `recap-scenarios.ts` (edge-safe)

## Tests à écrire
Tests volontairement légers pour dev tools — pas de couvertures lourdes.

- `lib/dev/__tests__/apply-scenario.test.ts` (gated SUPABASE_RECAP_TESTS=1) : 2-3 scenarios smoke (happy-surplus-light, deficit-cascade-full, group-positive-2-members). Assert no throw + DB state vérifiable.
- Optionnel : `lib/dev/__tests__/recap-scenarios.test.ts` (non-gated) : assert all scenarios have valid structure (every budget has unique name, expenses reference existing budget names, etc.).

## Pièges et points d'attention
- **Cleanup ordre** : DELETE monthly_recaps en PREMIER (sinon FK CASCADE drops les budget_transfers row references). Puis expenses/incomes. Puis budgets.
- **`is_carried_over` reset** : doit être reset à false AVANT seed, sinon les expenses du scenario nouvellement créées avec is_carried_over=true (carried scenarios) collisionnent avec celles déjà flaggées.
- **Group scenarios** : si scenario.group.create = true, vérifier que le user n'est PAS déjà dans un groupe (sinon mess). Soit : creer un new group + transfer user, soit : assume user has group_id null. Doc le pré-requis.
- **Resume scenarios** : créer la row `monthly_recaps` avec les champs `current_step`, `started_by_profile_id`, `started_at`, `refloated_from_*`, `budget_snapshot_data` pour simuler un état mid-flow.
- **Idempotency seed** : appeler seed 2× consécutifs doit produire le même state final (le cleanup phase nettoie d'abord). NE PAS additionner les expenses des 2 seeds.
- **Pas de tests RTL** sur DevRecapClient — c'est une dev tool, ROI test faible.
- **Ne PAS oublier `blockInProduction()`** en première instruction — si oublié, exposé en prod et les attaquants peuvent fucker la DB.
- **Pattern d'auth** : `withAuthAndProfile` après `blockInProduction` (cf. CLAUDE.md "Hors scope wrapper" mentionne que `app/api/debug/**` est hors scope wrapper, mais pour les endpoints qui MUTATE DB, il faut quand même l'auth — wrap après le block).
- **Edge runtime constraint** : `lib/dev/recap-scenarios.ts` doit être edge-safe (0 import Supabase). Le apply-scenario.ts (server-only) est séparé.

## Commandes utiles
```bash
# Smoke applyScenario
SUPABASE_RECAP_TESTS=1 pnpm test:run lib/dev/__tests__/apply-scenario.test.ts

# Manuel
pnpm dev
# Browser : http://localhost:3000/dev/recap
# Click "Seed happy-surplus-light" → puis "Aller au recap"
```

## Definition of Done
- Tous les critères d'acceptation cochés
- 20+ scenarios définis, tous testables via DevRecapClient
- Smoke test manuel : seed 4 scénarios différents (1 positif, 1 négatif, 1 group, 1 resume), naviguer recap, observer le state attendu
- Commit `feat(recap): dev tools + 25 scenarios for testing`
- `pnpm verify` exit 0
