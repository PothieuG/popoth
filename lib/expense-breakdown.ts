/**
 * Pure expense breakdown algorithm — no I/O, no Supabase, no React.
 * Extracted from `lib/expense-allocation.ts` so client-side previews can
 * import it without pulling in the service_role Supabase client (security:
 * bundling supabase-server.ts in the client bundle would leak the
 * service_role key).
 *
 * Two algorithms:
 *   - `calculateBreakdown` (legacy P4-P5 strict, single-budget).
 *   - `calculateBreakdownWithAutoCascade` (auto piggy-first + cross-budget
 *     proportional cascade when overflow > 0). Used in ADD mode where
 *     the user no longer selects sources manually.
 */

export interface CrossBudgetDebit {
  budget_id: string
  amount: number
}

export interface AllocationBreakdown {
  fromPiggyBank: number
  fromBudgetSavings: number
  fromBudget: number
  /**
   * Amount remaining after all local cascades (budget + local savings).
   * `overflow > 0` signals Phase 2 cross-budget cascade need (handled
   * separately by the route handler / UI step). Consumers MUST handle
   * non-zero overflow explicitly — leaving it unhandled means the
   * breakdown doesn't sum to `amount`.
   */
  overflow: number
}

export interface AllocationBreakdownWithCascade extends AllocationBreakdown {
  /**
   * Cross-budget cascade debits produced when overflow > 0 and piggy
   * couldn't fully cover. Empty otherwise. Order follows the input
   * `otherBudgetsSavings` array. With auto-cascade, `overflow` will be 0
   * (residual absorbed into `fromBudget` as a deficit).
   */
  crossBudgetDebits: CrossBudgetDebit[]
}

export interface CalculateBreakdownOptions {
  /**
   * P5 opt-in toggle "Utiliser les économies de ce budget" — when true,
   * the user actively chose to draw from the budget's local savings even
   * if the budget still has room. Savings consumed BEFORE the budget.
   *
   * When false (default): P4 strict — budget consumed first, savings
   * cascade only on overflow (budget remaining < amount).
   */
  useSavingsToggle?: boolean
}

export function calculateBreakdown(
  amount: number,
  budgetRemaining: number,
  savingsAvailable: number,
  options: CalculateBreakdownOptions = {},
): AllocationBreakdown {
  const { useSavingsToggle = false } = options
  let remaining = amount
  let fromBudget = 0
  let fromBudgetSavings = 0
  const fromPiggyBank = 0

  if (useSavingsToggle) {
    if (savingsAvailable > 0) {
      fromBudgetSavings = Math.min(remaining, savingsAvailable)
      remaining -= fromBudgetSavings
    }
    if (remaining > 0 && budgetRemaining > 0) {
      fromBudget = Math.min(remaining, budgetRemaining)
      remaining -= fromBudget
    }
  } else {
    if (budgetRemaining > 0) {
      fromBudget = Math.min(remaining, budgetRemaining)
      remaining -= fromBudget
    }
    if (remaining > 0 && savingsAvailable > 0) {
      fromBudgetSavings = Math.min(remaining, savingsAvailable)
      remaining -= fromBudgetSavings
    }
  }

  return { fromPiggyBank, fromBudgetSavings, fromBudget, overflow: remaining }
}

const roundCents = (value: number): number => Math.round(value * 100) / 100

/**
 * Auto-cascade breakdown — used in ADD mode for budgeted expenses.
 *
 * Allocation order:
 *   1. Destination budget's local savings (P5 default: savings d'abord).
 *   2. Destination budget itself (jusqu'à budgetRemaining).
 *   3. If overflow > 0 → piggy bank first (priority).
 *   4. If overflow > 0 → cross-budget savings prorata aux disponibilités.
 *   5. Residual overflow absorbé par `fromBudget` (déficit destination, RAV).
 *
 * Évolution de `calculateBreakdown` quand l'utilisateur accepte que la
 * tirelire et les autres budgets soient consommés automatiquement (UI :
 * encart violet informatif, plus de sélection manuelle). La règle ❌
 * "piggy JAMAIS auto-débitée" historique est amendée : piggy peut
 * désormais être auto-débitée mais UNIQUEMENT pour combler un overflow.
 */
export function calculateBreakdownWithAutoCascade(
  amount: number,
  budgetRemaining: number,
  savingsAvailable: number,
  piggyAvailable: number,
  otherBudgetsSavings: ReadonlyArray<{ budget_id: string; available: number }>,
  options: CalculateBreakdownOptions = {},
): AllocationBreakdownWithCascade {
  const local = calculateBreakdown(amount, budgetRemaining, savingsAvailable, {
    useSavingsToggle: options.useSavingsToggle ?? true,
  })

  if (local.overflow <= 0) {
    return { ...local, fromPiggyBank: 0, crossBudgetDebits: [] }
  }

  let remaining = local.overflow
  const fromPiggyBank = Math.min(remaining, Math.max(0, piggyAvailable))
  remaining = roundCents(remaining - fromPiggyBank)

  const sources = otherBudgetsSavings.filter((b) => b.available > 0)
  const crossBudgetDebits: CrossBudgetDebit[] = []

  if (remaining > 0 && sources.length > 0) {
    const totalAvailable = sources.reduce((s, b) => s + b.available, 0)
    const toAllocate = Math.min(remaining, totalAvailable)

    const rawShares = sources.map((b) => ({
      budget_id: b.budget_id,
      share: (b.available / totalAvailable) * toAllocate,
      available: b.available,
    }))
    const rounded = rawShares.map((r) => ({
      ...r,
      share: Math.min(roundCents(r.share), r.available),
    }))

    const sumRounded = rounded.reduce((s, r) => s + r.share, 0)
    const drift = roundCents(toAllocate - sumRounded)
    if (drift !== 0 && rounded.length > 0) {
      for (let i = rounded.length - 1; i >= 0; i--) {
        const entry = rounded[i]
        if (!entry) continue
        const headroom = roundCents(entry.available - entry.share)
        if (drift > 0 && headroom > 0) {
          const bump = Math.min(drift, headroom)
          entry.share = roundCents(entry.share + bump)
          break
        }
        if (drift < 0 && entry.share > 0) {
          const cut = Math.min(-drift, entry.share)
          entry.share = roundCents(entry.share - cut)
          break
        }
      }
    }

    for (const r of rounded) {
      if (r.share > 0) {
        crossBudgetDebits.push({ budget_id: r.budget_id, amount: r.share })
      }
    }
    const consumed = crossBudgetDebits.reduce((s, d) => s + d.amount, 0)
    remaining = roundCents(remaining - consumed)
  }

  const fromBudget = roundCents(local.fromBudget + Math.max(0, remaining))

  return {
    fromPiggyBank,
    fromBudgetSavings: local.fromBudgetSavings,
    fromBudget,
    overflow: 0,
    crossBudgetDebits,
  }
}
