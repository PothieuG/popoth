import {
  GET as financeIncomeRealGet,
  POST as financeIncomeRealPost,
  PUT as financeIncomeRealPut,
  DELETE as financeIncomeRealDelete,
} from '@/lib/api/finance/income-real'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeIncomeRealGet)
export const POST = withDeprecation(financeIncomeRealPost)
export const PUT = withDeprecation(financeIncomeRealPut)
export const DELETE = withDeprecation(financeIncomeRealDelete)
