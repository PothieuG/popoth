# Conventions TypeScript

> Extraction détaillée de CLAUDE.md §6 TypeScript + invariants chiffrés.

## Configuration

- `verbatimModuleSyntax` actif → **`import type` obligatoire** pour les types.
- `noUncheckedIndexedAccess` actif → `arr[i]` est `T | undefined`. Toujours narrow avant d'utiliser.

## Catch errors

Erreurs catch : `error: unknown` par défaut → narrow via `error instanceof Error ? error.message : String(error)`. **Préférer `} catch {` (sans binding) si la valeur n'est pas utilisée** — TS 4.4+ supporte le binding optionnel et c'est plus propre que `_error` (l'ESLint actuelle ne reconnaît pas le préfixe `_` pour `no-unused-vars`).

## Casts

Préférer `as unknown as T` plutôt que `as any` lorsqu'un cast est inévitable.

## Invariants TS

- **Aucun `any`** dans le codebase depuis Sprint Lint-Baseline-Cleanup (livré 2026-05-08). 69 sites `: any` existants ont été typés strict, et `pnpm lint:check` est désormais bloquant en CI (`code-checks.yml`) — toute nouvelle PR avec un `: any` sort rouge.
- Compteur `as unknown as SupabaseClient` à **0** dans tout le code TypeScript depuis le Sprint Refactor-I5 (2026-05-11) — le dernier site (process-step1/route.ts) a disparu avec l'extraction du god file vers `lib/recap/`. **Ne pas en réintroduire** — débugger le typage à la place. Les seules occurrences résiduelles sont dans les docs/prompts pour référence historique.
- Compteur `declare global` à **0** dans tout le code depuis Sprint Refactor-I6 (2026-05-14). Les 4 globals de `complete/route.ts` sont devenus des champs explicites sur `ProcessCompleteDecision`.

## Patterns clés

### Supabase Insert/Update payloads

Utiliser `Database['public']['Tables']['<table>']['Insert' | 'Update']` depuis [lib/database.types.ts](../../lib/database.types.ts). Pattern installé partout pendant Phase 4.2 du Sprint Lint-Baseline-Cleanup. Exemples : [app/api/finance/budgets/estimated](../../app/api/finance/budgets/estimated/route.ts), [app/api/finance/expenses/real](../../app/api/finance/expenses/real/route.ts).

Pour les computed keys dynamic `[ownerField]: contextId` où `ownerField: 'profile_id' | 'group_id'`, narrow via if/else explicit (Sprint Supabase-Strict-Types 2026-05-14) :

```ts
const payload: TablesInsert<'budget_transfers'> =
  context === 'profile' ? { profile_id: contextId, ...base } : { group_id: contextId, ...base }
```

Pour `.map()` callbacks, narrow dans le callback avec spread base. Pour `Record<string, unknown>` accumulators d'update partiel, typer explicitement avec `TablesUpdate<>`.

### `FinancialData` import

Importer le type via `import { ..., type FinancialData } from '@/lib/finance'` (Sprint Lint-Baseline-Cleanup Phase 4.2 ; god file `lib/financial-calculations.ts` supprimé au Sprint Refactor-I4 → migration vers `lib/finance/`).

### Hook return types

Préférer ré-exporter les interfaces internes (`export interface EstimatedBudget {...}`) plutôt que dupliquer en consumer. Pattern installé sur [hooks/useBudgets.ts](../../hooks/useBudgets.ts), [hooks/useIncomes.ts](../../hooks/useIncomes.ts), [hooks/useRealExpenses.ts](../../hooks/useRealExpenses.ts), [hooks/useRealIncomes.ts](../../hooks/useRealIncomes.ts).

### JSONB blobs

Pour les blobs JSONB côté DB (`Json` dans `lib/database.types.ts`) : définir un type discriminé applicatif et caster `as unknown as Json` au seul boundary insert. Pattern : [lib/recap-snapshot.types.ts](../../lib/recap-snapshot.types.ts).

### Discriminated unions

Pattern installé partout (Sprint Refactor-I5 sur `step1-algorithm.ts` `AllocationOperation`, Sprint Refactor-I6 sur `complete-algorithm.ts`, Sprint Refactor-Auto-Balance, Sprint Refactor-Recover). Pour la `RestorationAction` du recover :

```ts
export type RestorationAction =
  | { kind: 'restore_table'; table: RestorableTable; rows: TablesInsert<RestorableTable>[] }
  | { kind: 'update_bank_balance_v1'; amount: number }
```

Pour les FieldErrors d'un discriminated union RHF, voir [zod-patterns.md](zod-patterns.md) §7.
