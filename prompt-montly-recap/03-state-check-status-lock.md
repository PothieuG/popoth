# [03] — State + check-status + lock + schémas Zod

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3, wizard 5 écrans avec état persisté.
- Position dans la séquence : étape 03/17
- Dépend de : 02 (migrations DB)
- Débloque : 04 (calculations), 05 (endpoints start/status), 09 (UI shell + lock screen)

## Objectif
Créer les modules `lib/recap/check-status.ts` (state machine read), `lib/recap/state.ts` (transitions valides), `lib/recap/lock.ts` (détection lock groupe pour les non-initiateurs) et `lib/schemas/recap.ts` (tous les schémas Zod V3). Ces modules sont pure-async (I/O Supabase, pas de calcul métier — voir 04 pour ça).

## Fichiers concernés
- `lib/recap/check-status.ts` — à créer (nouveau fichier — l'ancien a été supprimé en 01)
- `lib/recap/state.ts` — à créer
- `lib/recap/lock.ts` — à créer
- `lib/recap/index.ts` — à créer (barrel)
- `lib/schemas/recap.ts` — à étendre (placeholder créé en 01, mais quasi-vide)
- `lib/schemas/common.ts` — à lire pour réutiliser primitives (cf. CLAUDE.md §6 Zod)

## Patterns et conventions à respecter
- **Zod factory + parseBody pattern** : cf. [.claude/conventions/zod-patterns.md](../.claude/conventions/zod-patterns.md) §2.
- **Discriminated unions** pour le state : `{ kind: 'no_recap' } | { kind: 'in_progress', step, ... } | { kind: 'locked_by_other', startedBy, ... } | { kind: 'completed' }`.
- **TypeScript strict** : `verbatimModuleSyntax` actif → `import type` obligatoire. `noUncheckedIndexedAccess` → narrow les accès indexés.
- **Custom error class** : pattern `RecapStatusError extends Error` avec champ `code` literal union (cf. l'ancien `lib/recap/check-status.ts` supprimé en 01 — ré-implémenter avec les nouveaux codes).
- **Tests unitaires** : co-localisés (`lib/recap/__tests__/state.test.ts`) ou inline (`lib/recap/state.test.ts`). Vitest non-gated pour state.ts (pure), gated `SUPABASE_RECAP_TESTS` pour check-status.ts.

## Détail des modules

### `lib/recap/state.ts` — pure transitions

```ts
export type RecapStep = 'welcome' | 'summary' | 'manage_bilan' | 'salary_update' | 'final_recap' | 'completed'

export const RECAP_STEP_ORDER: readonly RecapStep[] = [
  'welcome', 'summary', 'manage_bilan', 'salary_update', 'final_recap', 'completed',
] as const

export function isAdvanceAllowed(from: RecapStep, to: RecapStep): boolean {
  // Forward-only: to.index > from.index strictly
  // Allow skipping (e.g. manage_bilan → salary_update direct if no bilan management needed)
  const fi = RECAP_STEP_ORDER.indexOf(from)
  const ti = RECAP_STEP_ORDER.indexOf(to)
  return fi >= 0 && ti > fi
}

export function nextRequiredStep(current: RecapStep, bilan: number): RecapStep {
  // welcome → summary → manage_bilan (always shown) → salary_update → final_recap → completed
  // (manage_bilan content varies based on bilan sign — same step name, different UI)
  ...
}
```

### `lib/recap/check-status.ts` — async read DB

```ts
export type RecapStatusKind =
  | { kind: 'no_recap' }                          // pas de row monthly_recaps pour ce mois
  | { kind: 'in_progress', recapId: string, step: RecapStep, startedAt: string, startedByProfileId: string }
  | { kind: 'locked_by_other', recapId: string, startedByProfileId: string, startedByName?: string }  // groupe seulement
  | { kind: 'completed', recapId: string, completedAt: string }

export type RecapContext = 'profile' | 'group'

export interface RecapStatusResult {
  context: RecapContext
  contextId: string  // profile.id ou group.id
  status: RecapStatusKind
  currentMonth: number
  currentYear: number
}

export class RecapStatusError extends Error {
  constructor(
    public code: 'PROFILE_NOT_FOUND' | 'NO_GROUP',
    message: string,
  ) { super(message); this.name = 'RecapStatusError' }
}

export async function checkRecapStatus(userId: string, context: RecapContext): Promise<RecapStatusResult> {
  // 1. Récupérer profile (profileId, group_id, first_name, last_name)
  // 2. Calculer current month/year
  // 3. Si context=profile : SELECT monthly_recaps WHERE profile_id=user.id AND month/year
  //    Si row absent → kind='no_recap'
  //    Si row.completed_at non null → kind='completed'
  //    Si row.started_by_profile_id = user.id → kind='in_progress'
  //    (en mode profile, started_by est toujours == user.id donc pas de lock)
  // 4. Si context=group : SELECT monthly_recaps WHERE group_id=profile.group_id AND month/year
  //    Si absent → kind='no_recap'
  //    Si completed_at non null → kind='completed'
  //    Si started_by_profile_id = user.id → kind='in_progress'
  //    Sinon → kind='locked_by_other' (fetch nom de l'initiateur via JOIN profiles)
}
```

### `lib/recap/lock.ts` — helper de détection (utilisé par proxy + status endpoint)

```ts
// Helper sync sur RecapStatusResult.status :
export function isUserLocked(status: RecapStatusKind): boolean {
  return status.kind === 'locked_by_other'
}

export function isRecapBlocking(status: RecapStatusKind): boolean {
  // True si l'app doit forcer la nav vers /monthly-recap
  // ('no_recap' = on doit lancer, 'in_progress' = on doit continuer, 'locked_by_other' = on bloque écran lock)
  return status.kind === 'no_recap' || status.kind === 'in_progress' || status.kind === 'locked_by_other'
}
```

### `lib/recap/index.ts` — barrel

```ts
export { checkRecapStatus, RecapStatusError } from './check-status'
export type { RecapContext, RecapStatusResult, RecapStatusKind } from './check-status'
export { isUserLocked, isRecapBlocking } from './lock'
export { RECAP_STEP_ORDER, isAdvanceAllowed, nextRequiredStep } from './state'
export type { RecapStep } from './state'
```

### `lib/schemas/recap.ts` — schémas Zod

```ts
import { z } from 'zod'
import { contextSchema, uuidSchema, moneySchema, nonNegativeMoneySchema } from './common'

// Body POST /api/monthly-recap/start
export const startRecapBodySchema = z.object({ context: contextSchema })

// Body POST /api/monthly-recap/transfer-surpluses-to-piggy
export const transferSurplusesBodySchema = z.object({
  context: contextSchema,
  budgetIds: z.array(uuidSchema).min(1),
})

// Body POST /api/monthly-recap/refloat-from-piggy
export const refloatFromPiggyBodySchema = z.object({
  context: contextSchema,
  amount: z.number().positive().finite(),
})

// Body POST /api/monthly-recap/save-budget-snapshot
export const saveBudgetSnapshotBodySchema = z.object({
  context: contextSchema,
  // Snapshot = record budget_id → amount à puiser
  snapshot: z.record(uuidSchema, nonNegativeMoneySchema),
})

// Body POST /api/monthly-recap/update-salaries
export const updateSalariesBodySchema = z.object({
  context: contextSchema,
  salaries: z.array(z.object({
    profileId: uuidSchema,
    salary: z.number().nonnegative().finite(),
  })).min(1),
})

// Body POST /api/monthly-recap/complete (rewrite — finalize)
export const completeRecapBodySchema = z.object({
  context: contextSchema,
})

// Query GET /api/monthly-recap/status
export const statusQuerySchema = z.object({ context: contextSchema })

// Exports types
export type StartRecapBody = z.infer<typeof startRecapBodySchema>
// ... ditto pour chaque schema
```

## Étapes d'implémentation suggérées
1. **Lire les patterns** : [.claude/conventions/zod-patterns.md](../.claude/conventions/zod-patterns.md), [lib/schemas/common.ts](../lib/schemas/common.ts), [lib/api/parse-body.ts](../lib/api/parse-body.ts).
2. **Créer `lib/recap/state.ts`** : RecapStep enum + RECAP_STEP_ORDER + helpers `isAdvanceAllowed`, `nextRequiredStep`. Exporter types. Pure code, 0 I/O.
3. **Créer `lib/recap/check-status.ts`** : RecapStatusResult + RecapStatusError + checkRecapStatus async. Réutiliser le pattern de l'ancien `lib/recap/check-status.ts` mais avec les nouveaux discriminated unions + lecture des nouveaux champs (`current_step`, `started_by_profile_id`, `completed_at`).
4. **Créer `lib/recap/lock.ts`** : helpers sync `isUserLocked` + `isRecapBlocking` (pure functions sur RecapStatusKind).
5. **Créer `lib/recap/index.ts`** : barrel exports.
6. **Étendre `lib/schemas/recap.ts`** : tous les schémas Zod V3. Réutiliser les primitives `contextSchema`, `uuidSchema`, `moneySchema`, `nonNegativeMoneySchema` de `lib/schemas/common.ts`. Si une primitive manque, l'ajouter dans common.ts.
7. **Tests unitaires `lib/recap/__tests__/state.test.ts`** : test isAdvanceAllowed (8+ cases), test nextRequiredStep (positif, négatif, no-bilan).
8. **Tests gated `lib/recap/__tests__/check-status.test.ts`** (gated `SUPABASE_RECAP_TESTS=1`) : seed 4 fixtures (no_recap, in_progress_own, locked_by_other, completed) puis assert kind correct.
9. **Tests schémas `lib/schemas/__tests__/recap.test.ts`** : assert chaque schema accepte/rejette les cas attendus (5+ cas par schema).
10. **Vérifs** : `pnpm typecheck` + `pnpm lint:check` + `pnpm test:run` exit 0.
11. **Commit** : `feat(recap): state machine + check-status + lock + Zod schemas V3`.

## Critères d'acceptation
- [ ] `lib/recap/state.ts` exporte `RecapStep`, `RECAP_STEP_ORDER`, `isAdvanceAllowed`, `nextRequiredStep`
- [ ] `lib/recap/check-status.ts` exporte `checkRecapStatus`, `RecapStatusError`, types associés
- [ ] `lib/recap/lock.ts` exporte `isUserLocked`, `isRecapBlocking`
- [ ] `lib/recap/index.ts` re-exporte tout proprement
- [ ] `lib/schemas/recap.ts` exporte ≥ 7 schémas Zod nommés (start, transferSurpluses, refloatFromPiggy, refloatFromSavings, saveBudgetSnapshot, updateSalaries, complete, status query)
- [ ] `RecapStatusKind` est une vraie discriminated union (kind: literal)
- [ ] Tests state.ts : ≥ 8 cas isAdvanceAllowed + ≥ 4 cas nextRequiredStep
- [ ] Tests check-status.ts gated (`SUPABASE_RECAP_TESTS=1`) : 4 fixtures couvertes
- [ ] Tests recap.test.ts schémas : ≥ 5 cas par schema
- [ ] `pnpm typecheck` + `pnpm lint:check` + `pnpm test:run` exit 0
- [ ] Aucun `any` ni `as unknown as SupabaseClient` (invariants CLAUDE.md §5.5)

## Tests à écrire

### `lib/recap/__tests__/state.test.ts` (non-gated, pure)
- isAdvanceAllowed welcome→summary OK
- isAdvanceAllowed summary→manage_bilan OK
- isAdvanceAllowed summary→welcome REJECT (backward forbidden)
- isAdvanceAllowed completed→anything REJECT
- isAdvanceAllowed same→same REJECT
- isAdvanceAllowed skip forward (welcome→salary_update) OK (allow skip — manage_bilan peut être no-op)
- nextRequiredStep return 'manage_bilan' from 'summary' regardless of bilan sign
- nextRequiredStep return 'salary_update' from 'manage_bilan'

### `lib/recap/__tests__/check-status.test.ts` (gated SUPABASE_RECAP_TESTS=1)
- profile, no row → kind='no_recap'
- profile, row in_progress (started_by = user) → kind='in_progress'
- profile, row completed → kind='completed'
- group, row in_progress (started_by = autre membre) → kind='locked_by_other' avec startedByName fetched
- group, row in_progress (started_by = user) → kind='in_progress' (l'initiateur n'est pas lock)
- profile inexistant → throw RecapStatusError code=PROFILE_NOT_FOUND
- group context mais user.group_id null → throw RecapStatusError code=NO_GROUP

### `lib/schemas/__tests__/recap.test.ts` (non-gated)
Par schema : valid case + invalid cases (champ manquant, type incorrect, enum out-of-range, array vide pour minLength)

## Pièges et points d'attention
- **NE PAS** ré-utiliser le code de l'ancien `lib/recap/check-status.ts` (supprimé en 01) verbatim — la nouvelle table `monthly_recaps` a des colonnes différentes (current_step, started_by_profile_id, etc.).
- **Discriminated union `RecapStatusKind`** : utiliser `kind: 'literal'` (pas `type` qui collide avec React `type` prop). TS narrow correctement avec `kind`.
- **PostgREST single() vs maybeSingle()** : utiliser `.maybeSingle()` pour la lookup `monthly_recaps` car la row peut ne pas exister (cas 'no_recap'). `.single()` throw PGRST116 si 0 rows. Cf. CLAUDE.md `❌ Tables owner-row hybrides`.
- **Group lock detection** : si `started_by_profile_id != user.id` AND `completed_at IS NULL`, c'est lock. Si `started_by_profile_id IS NULL` (cas où la row a été créée mais le start n'a pas claim, edge case), considérer comme `no_recap` (le start n'a pas vraiment eu lieu).
- **Pas de Zod refine cross-field pour l'instant** : les schémas sont simples (1 niveau). Si un cross-field refine est nécessaire (ex. `salaries` n'a pas de doublons profileId), l'ajouter via `.refine()` mais ne pas surcompliquer.
- **`updateSalaries` schema** : valide la STRUCTURE seulement. La validation business (tous profileId sont membres du groupe + user est l'initiateur) se fait dans l'endpoint (sous-tâche 07).
- **Tests gated** : utiliser le pattern `chunked` + `await import()` dans beforeAll + cleanup cascade afterAll (cf. CLAUDE.md §9 Tests).
- **Pas de side-effects en module-level** : les modules `state.ts`/`lock.ts` doivent rester purs (0 import Supabase). Seul `check-status.ts` importe `supabaseServer`.

## Commandes utiles
```bash
# Tests non-gated
pnpm test:run lib/recap/__tests__/state.test.ts lib/schemas/__tests__/recap.test.ts

# Tests gated check-status (require env var)
SUPABASE_RECAP_TESTS=1 pnpm test:run lib/recap/__tests__/check-status.test.ts

# Lint + typecheck
pnpm typecheck && pnpm lint:check

# Sanity sweep
pnpm verify
```

## Definition of Done
- Tous les critères d'acceptation cochés
- `lib/recap/` contient 4 fichiers (check-status, state, lock, index) + dossier __tests__
- `lib/schemas/recap.ts` contient ≥ 7 schémas Zod
- Discriminated union `RecapStatusKind` testée avec tous les cas via fixtures gated
- Commit `feat(recap): state machine + check-status + lock + Zod schemas V3`
- `pnpm verify` exit 0
