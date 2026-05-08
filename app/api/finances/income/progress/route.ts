import { GET as financeIncomeProgressGet } from '@/lib/api/finance/income-progress'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeIncomeProgressGet)
