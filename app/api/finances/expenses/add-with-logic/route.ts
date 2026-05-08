import { POST as financeExpensesAddWithLogicPost } from '@/lib/api/finance/expenses-add-with-logic'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const POST = withDeprecation(financeExpensesAddWithLogicPost)
