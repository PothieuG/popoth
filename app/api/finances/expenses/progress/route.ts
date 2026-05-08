import { GET as financeExpensesProgressGet } from '@/lib/api/finance/expenses-progress'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeExpensesProgressGet)
