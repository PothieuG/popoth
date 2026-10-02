import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndGroup } from '@/lib/api/with-auth'
import { parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { now } from '@/lib/clock'
import { previewBreakdownQuerySchema } from '@/lib/schemas/expense'
import {
  calculateBreakdown,
  calculateBreakdownWithCoverage,
  EMPTY_COVERAGE,
  type OverflowCoverage,
} from '@/lib/expense-breakdown'

export interface CrossBudgetDebitPreview {
  budget_id: string
  budget_name: string
  amount: number
  available_before: number
  available_after: number
}

/** Économies d'un autre budget mobilisables pour couvrir le dépassement. */
export interface BudgetSavingsAvailability {
  budget_id: string
  budget_name: string
  available: number
}

export interface ExpenseBreakdownPreview {
  total_amount: number
  from_piggy_bank: number
  from_budget_savings: number
  from_budget: number
  piggy_bank_before: number
  piggy_bank_after: number
  savings_before: number
  savings_after: number
  budget_spent_before: number
  budget_spent_after: number
  budget_estimated: number
  budget_name: string
  cross_budget_debits: CrossBudgetDebitPreview[]
  /**
   * Sprint Expense-Overflow-Coverage — dépassement après économies du budget
   * et budget lui-même (avant toute couverture), et réserves disponibles pour
   * le couvrir (tirelire = `piggy_bank_before`). Alimentent l'étape
   * « Couvrir le dépassement » de la modale d'ajout.
   */
  overflow: number
  other_budgets_savings: BudgetSavingsAvailability[]
}

/**
 * GET /api/finance/expenses/preview-breakdown
 *
 * Previews the breakdown of a budgeted expense — ADD mode (no expense_id) or
 * EDIT mode (with expense_id). Sprint Expense-Overflow-Coverage (2026-10-02),
 * `calculateBreakdownWithCoverage` :
 *   - ADD : sans couverture — le dépassement va en déficit (reste à vivre),
 *     comportement par défaut. La couverture choisie dans l'étape « Couvrir
 *     le dépassement » est appliquée côté client à partir de `overflow` et
 *     des réserves renvoyées (aperçu en direct, sans aller-retour serveur).
 *   - EDIT : sur l'état post-reverse virtuel (sources d'origine restaurées
 *     dans les pools courants, lecture via expense_savings_sources ou fallback
 *     colonnes consolidées si pas de trace), en gardant les sources d'origine :
 *     jamais de nouvelle réserve prise, le supplément va en déficit.
 */
export const GET = withAuthAndGroup(async (request: NextRequest, { userId, groupId }) => {
  try {
    const {
      amount,
      budget_id: budgetId,
      context,
      expense_id: expenseId,
      month,
      year,
    } = parseQuery(request, previewBreakdownQuerySchema)

    const isGroup = context === 'group'
    let contextFilter: { group_id: string } | { profile_id: string }

    if (isGroup) {
      if (!groupId) {
        return NextResponse.json({ error: 'Groupe non trouvé' }, { status: 404 })
      }
      contextFilter = { group_id: groupId }
    } else {
      contextFilter = { profile_id: userId }
    }

    const { data: piggyBankData } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .match(contextFilter)
      .maybeSingle()
    const piggyBankCurrent = piggyBankData?.amount || 0

    let existingExpense: {
      amount: number
      amount_from_piggy_bank: number
      amount_from_budget_savings: number
      amount_from_budget: number
    } | null = null
    const oldSourcesByBudget = new Map<string, number>()
    let oldPiggyFromSources = 0
    let hasTrace = false

    if (expenseId) {
      const { data: expData } = await supabaseServer
        .from('real_expenses')
        .select('amount, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget')
        .eq('id', expenseId)
        .single()

      if (expData) {
        existingExpense = {
          amount: expData.amount,
          amount_from_piggy_bank: expData.amount_from_piggy_bank || 0,
          amount_from_budget_savings: expData.amount_from_budget_savings || 0,
          amount_from_budget: expData.amount_from_budget || 0,
        }

        const { data: sources } = await supabaseServer
          .from('expense_savings_sources')
          .select('source_type, source_budget_id, amount')
          .eq('real_expense_id', expenseId)

        hasTrace = (sources?.length ?? 0) > 0
        for (const s of sources ?? []) {
          if (s.source_type === 'piggy') {
            oldPiggyFromSources += s.amount
          } else if (s.source_type === 'budget_savings' && s.source_budget_id) {
            oldSourcesByBudget.set(
              s.source_budget_id,
              (oldSourcesByBudget.get(s.source_budget_id) ?? 0) + s.amount,
            )
          }
        }
      }
    }

    const piggyBankBefore =
      piggyBankCurrent +
      (existingExpense
        ? hasTrace
          ? oldPiggyFromSources
          : existingExpense.amount_from_piggy_bank
        : 0)

    const { data: budgetData, error: budgetError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings, carryover_spent_amount')
      .eq('id', budgetId)
      .match(contextFilter)
      .single()

    if (budgetError || !budgetData) {
      return NextResponse.json({ error: 'Budget non trouvé' }, { status: 404 })
    }

    const destinationOldClaim = existingExpense
      ? hasTrace
        ? (oldSourcesByBudget.get(budgetId) ?? 0)
        : existingExpense.amount_from_budget_savings
      : 0
    const savingsBefore = (budgetData.cumulated_savings || 0) + destinationOldClaim

    // Filter by month + carried_from_recap_id IS NULL. Quand `month`/`year`
    // sont fournis (wizard récap "Compléter le mois"), on filtre le mois
    // recapé pour que le `budget_spent_before` reflète l'état DB du mois en
    // cours de clôture — sinon la preview lit 0€ et affiche un budget
    // faussement remis à zéro (Sprint Fix-Recap-Preview-Month 2026-05-27).
    // Fallback `today.month` pour le Dashboard. Le filtre carry-over (Part 35)
    // exclut les transactions héritées d'un recap antérieur dans les 2 états
    // (en attente + validée) — une validation post-recap modifie le solde
    // mais pas le `budget_spent_before` du mois courant.
    const useExplicitMonth = month != null && year != null
    const refYear = useExplicitMonth ? year : now().getFullYear()
    const refMonth0 = useExplicitMonth ? month - 1 : now().getMonth()
    const firstDayCurrentPreview = `${refYear}-${String(refMonth0 + 1).padStart(2, '0')}-01`
    const lastDayCurrentPreview = (() => {
      const d = new Date(refYear, refMonth0 + 1, 0)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()
    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('id, amount, amount_from_budget')
      .eq('estimated_budget_id', budgetId)
      .is('carried_from_recap_id', null)
      .gte('expense_date', firstDayCurrentPreview)
      .lte('expense_date', lastDayCurrentPreview)
      .match(contextFilter)

    const budgetSpentCurrent =
      expenses?.reduce((sum, e) => {
        const amountFromBudget =
          e.amount_from_budget !== null && e.amount_from_budget !== undefined
            ? e.amount_from_budget
            : e.amount
        return sum + amountFromBudget
      }, 0) || 0

    // En EDIT : on soustrait la contribution budget de l'existing pour
    // simuler l'état post-reverse virtuel. En ADD : pas de soustraction.
    // Le carryover (déficit reporté du recap précédent) est un terme
    // constant sur le mois courant, indépendant des dépenses du mois — il
    // doit participer à `budgetSpentBefore` pour que `budgetRemaining` =
    // marge réellement libre sur le pool. Sans ça, le dépassement n'est
    // pas détecté quand le carryover sature déjà le cap, et la preview
    // affiche un budget faussement remis à zéro (cf. dashboard
    // `budget.spent_this_month` qui inclut le carryover).
    const carryoverSpent = budgetData.carryover_spent_amount ?? 0
    const budgetSpentBefore =
      (existingExpense
        ? budgetSpentCurrent - existingExpense.amount_from_budget
        : budgetSpentCurrent) + carryoverSpent
    const budgetRemaining = budgetData.estimated_amount - budgetSpentBefore

    // Lire les autres budgets avec savings (post-reverse en EDIT).
    const { data: otherBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, cumulated_savings')
      .match(contextFilter)
      .neq('id', budgetId)

    const otherBudgetsPostReverse = (otherBudgets ?? [])
      .map((b) => {
        const current = b.cumulated_savings ?? 0
        const oldClaim = existingExpense && hasTrace ? (oldSourcesByBudget.get(b.id) ?? 0) : 0
        return {
          budget_id: b.id,
          budget_name: b.name,
          available_before: current + oldClaim,
        }
      })
      .filter((b) => b.available_before > 0)

    // EDIT : sources d'origine de la couverture (tirelire + économies des
    // autres budgets) ; sans trace, seule la part tirelire est connue.
    const existingCoverage: OverflowCoverage = existingExpense
      ? {
          piggy: hasTrace ? oldPiggyFromSources : existingExpense.amount_from_piggy_bank,
          budgets: [...oldSourcesByBudget.entries()]
            .filter(([sourceId]) => sourceId !== budgetId)
            .map(([sourceId, sourceAmount]) => ({ budget_id: sourceId, amount: sourceAmount })),
        }
      : EMPTY_COVERAGE

    const { overflow } = calculateBreakdown(amount, budgetRemaining, savingsBefore, {
      useSavingsToggle: true,
    })
    const allocation = calculateBreakdownWithCoverage(
      amount,
      budgetRemaining,
      savingsBefore,
      existingCoverage,
    )
    const fromPiggyBank = allocation.fromPiggyBank
    const fromBudgetSavings = allocation.fromBudgetSavings
    const fromBudget = allocation.fromBudget

    const crossBudgetDebitsPreview: CrossBudgetDebitPreview[] = allocation.crossBudgetDebits.map(
      (d) => {
        const src = otherBudgetsPostReverse.find((b) => b.budget_id === d.budget_id)
        const availableBefore = src?.available_before ?? 0
        return {
          budget_id: d.budget_id,
          budget_name: src?.budget_name ?? '',
          amount: d.amount,
          available_before: availableBefore,
          available_after: Math.round((availableBefore - d.amount) * 100) / 100,
        }
      },
    )

    const budgetSpentAfter = budgetSpentBefore + fromBudget

    const breakdown: ExpenseBreakdownPreview = {
      total_amount: amount,
      from_piggy_bank: fromPiggyBank,
      from_budget_savings: fromBudgetSavings,
      from_budget: fromBudget,
      piggy_bank_before: piggyBankBefore,
      piggy_bank_after: piggyBankBefore - fromPiggyBank,
      savings_before: savingsBefore,
      savings_after: savingsBefore - fromBudgetSavings,
      budget_spent_before: budgetSpentBefore,
      budget_spent_after: budgetSpentAfter,
      budget_estimated: budgetData.estimated_amount,
      budget_name: budgetData.name,
      cross_budget_debits: crossBudgetDebitsPreview,
      overflow,
      other_budgets_savings: otherBudgetsPostReverse.map((b) => ({
        budget_id: b.budget_id,
        budget_name: b.budget_name,
        available: b.available_before,
      })),
    }

    return NextResponse.json({ breakdown })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
