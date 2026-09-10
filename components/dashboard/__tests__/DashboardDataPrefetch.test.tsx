/**
 * Sprint Perf-Waterfall (2026-09-10) — `DashboardDataPrefetch`.
 *
 * Ce composant ne rend rien : son seul effet observable est de lancer les
 * requêtes de contenu. Le test vérifie donc exactement ça — qu'elles partent au
 * montage du layout, sans attendre `GET /api/profile`.
 *
 * Le contrat qui compte : les `queryKey` amorcées doivent être CELLES que les
 * pages consomment. Une clé qui diverge (un `context` ou un `period` différent)
 * ajouterait un appel réseau sans jamais servir.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

// `vi.mock` est hoisté au-dessus des `const` du module : le recorder doit donc
// naître dans `vi.hoisted`, sinon les factories le référencent avant init.
const { CALLS, record } = vi.hoisted(() => {
  const calls: { hook: string; args: unknown[] }[] = []
  return {
    CALLS: calls,
    record:
      (hook: string) =>
      (...args: unknown[]) => {
        calls.push({ hook, args })
        return {}
      },
  }
})

vi.mock('@/hooks/useBudgets', () => ({ useBudgets: record('useBudgets') }))
vi.mock('@/hooks/useIncomes', () => ({ useIncomes: record('useIncomes') }))
vi.mock('@/hooks/useProjects', () => ({ useProjects: record('useProjects') }))
vi.mock('@/hooks/useRealExpenses', () => ({ useRealExpenses: record('useRealExpenses') }))
vi.mock('@/hooks/useRealIncomes', () => ({ useRealIncomes: record('useRealIncomes') }))
vi.mock('@/hooks/useProgressData', () => ({ useProgressData: record('useProgressData') }))
vi.mock('@/hooks/usePeriodParam', () => ({
  usePeriodParam: () => ({ period: 'week', setPeriod: () => {} }),
}))

import DashboardDataPrefetch from '../DashboardDataPrefetch'

beforeEach(() => {
  CALLS.length = 0
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('DashboardDataPrefetch', () => {
  it('amorce les 6 requêtes de contenu dès le montage', () => {
    render(<DashboardDataPrefetch context="group" />)

    expect(CALLS.map((c) => c.hook)).toEqual([
      'useBudgets',
      'useIncomes',
      'useProjects',
      'useRealExpenses',
      'useRealIncomes',
      'useProgressData',
    ])
  })

  it('propage le contexte à chaque requête', () => {
    render(<DashboardDataPrefetch context="group" />)

    for (const call of CALLS) {
      expect(call.args[0]).toBe('group')
    }
  })

  it("propage la période de l'URL, pas la valeur par défaut", () => {
    // Amorcer `['progress-data', ctx, 'month']` alors que l'URL demande la
    // semaine remplirait une entrée de cache que personne ne lit, et laisserait
    // la vraie requête partir en 2e vague — le bug qu'on corrige.
    render(<DashboardDataPrefetch context="profile" />)

    const progress = CALLS.find((c) => c.hook === 'useProgressData')
    expect(progress?.args).toEqual(['profile', 'week'])
  })

  it('ne rend rien', () => {
    const { container } = render(<DashboardDataPrefetch context="profile" />)
    expect(container).toBeEmptyDOMElement()
  })
})
