import { Suspense } from 'react'

import { RecapShell } from '@/components/monthly-recap/RecapShell'
import { RecapWizard } from '@/components/monthly-recap/RecapWizard'

export default function MonthlyRecapPage({
  searchParams,
}: {
  searchParams: Promise<{ context?: string }>
}) {
  return (
    <Suspense
      fallback={
        <RecapShell>
          <p className="text-center text-sm text-gray-600">Chargement…</p>
        </RecapShell>
      }
    >
      <MonthlyRecapPageContent searchParams={searchParams} />
    </Suspense>
  )
}

async function MonthlyRecapPageContent({
  searchParams,
}: {
  searchParams: Promise<{ context?: string }>
}) {
  const params = await searchParams
  const context = params.context === 'group' ? 'group' : 'profile'
  return <RecapWizard context={context} />
}
