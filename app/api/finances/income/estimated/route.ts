import {
  GET as financeIncomeEstimatedGet,
  POST as financeIncomeEstimatedPost,
  PUT as financeIncomeEstimatedPut,
  DELETE as financeIncomeEstimatedDelete,
} from '@/lib/api/finance/income-estimated'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeIncomeEstimatedGet)
export const POST = withDeprecation(financeIncomeEstimatedPost)
export const PUT = withDeprecation(financeIncomeEstimatedPut)
export const DELETE = withDeprecation(financeIncomeEstimatedDelete)
