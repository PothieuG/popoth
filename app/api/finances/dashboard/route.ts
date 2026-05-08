import { GET as financeDashboardGet, POST as financeDashboardPost } from '@/lib/api/finance/dashboard'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(financeDashboardGet)
export const POST = withDeprecation(financeDashboardPost)
