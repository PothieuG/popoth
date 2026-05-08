import { GET as ravGet } from '@/lib/api/finance/rav'
import { withDeprecation } from '@/lib/api/with-deprecation'

export const GET = withDeprecation(ravGet)
