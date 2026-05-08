import {
  GET as financeBudgetsGet,
  POST as financeBudgetsPost,
  PUT as financeBudgetsPut,
  DELETE as financeBudgetsDelete,
} from '@/lib/api/finance/budgets'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeBudgetsGet)
export const POST = withDeprecation(financeBudgetsPost)
export const PUT = withDeprecation(financeBudgetsPut)
export const DELETE = withDeprecation(financeBudgetsDelete)
