import { GET as financeExpensesPreviewBreakdownGet } from '@/lib/api/finance/expenses-preview-breakdown'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeExpensesPreviewBreakdownGet)
