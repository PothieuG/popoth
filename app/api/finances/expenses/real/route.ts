import {
  GET as financeExpensesRealGet,
  POST as financeExpensesRealPost,
  PUT as financeExpensesRealPut,
  DELETE as financeExpensesRealDelete,
} from '@/lib/api/finance/expenses-real'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeExpensesRealGet)
export const POST = withDeprecation(financeExpensesRealPost)
export const PUT = withDeprecation(financeExpensesRealPut)
export const DELETE = withDeprecation(financeExpensesRealDelete)
