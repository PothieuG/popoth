import { GET as financeSummaryGet } from '@/lib/api/finance/summary'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeSummaryGet)
