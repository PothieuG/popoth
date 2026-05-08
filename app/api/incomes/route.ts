import {
  GET as financeIncomesGet,
  POST as financeIncomesPost,
  PUT as financeIncomesPut,
  DELETE as financeIncomesDelete,
} from '@/lib/api/finance/incomes'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeIncomesGet)
export const POST = withDeprecation(financeIncomesPost)
export const PUT = withDeprecation(financeIncomesPut)
export const DELETE = withDeprecation(financeIncomesDelete)
