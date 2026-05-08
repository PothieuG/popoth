import {
  GET as financeBudgetsEstimatedGet,
  POST as financeBudgetsEstimatedPost,
  PUT as financeBudgetsEstimatedPut,
  DELETE as financeBudgetsEstimatedDelete,
} from '@/lib/api/finance/budgets-estimated'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeBudgetsEstimatedGet)
export const POST = withDeprecation(financeBudgetsEstimatedPost)
export const PUT = withDeprecation(financeBudgetsEstimatedPut)
export const DELETE = withDeprecation(financeBudgetsEstimatedDelete)
