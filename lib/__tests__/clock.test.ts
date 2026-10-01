/**
 * Sprint Salary-Reception (2026-10-02) — `lib/clock`.
 *
 * Le point critique est le garde-fou : la date simulée ne doit JAMAIS
 * s'appliquer contre la base de prod (elle y déclencherait un vrai récap), où
 * que la variable soit posée et quel que soit `NODE_ENV`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSimulatedToday, now, todayIso } from '../clock'
import { getRecapPeriod } from '../recap/period'

const DEV_URL = 'https://ddehmjucyfgyppfkbddr.supabase.co'
const PROD_URL = 'https://jzmppreybwabaeycvasz.supabase.co'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('lib/clock', () => {
  it('sans variable : heure réelle', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', DEV_URL)
    expect(getSimulatedToday()).toBeNull()
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000)
  })

  it('base de test + date valide : date simulée, à midi heure locale', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', DEV_URL)
    vi.stubEnv('NEXT_PUBLIC_DEV_TODAY', '2026-09-30')

    const simulated = now()
    expect(simulated.getFullYear()).toBe(2026)
    expect(simulated.getMonth()).toBe(8)
    expect(simulated.getDate()).toBe(30)
    expect(simulated.getHours()).toBe(12)
    expect(todayIso()).toBe('2026-09-30')
  })

  it('base de PROD : variable ignorée, même en NODE_ENV=development', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PROD_URL)
    vi.stubEnv('NEXT_PUBLIC_DEV_TODAY', '2026-09-30')
    vi.stubEnv('NODE_ENV', 'development')

    expect(getSimulatedToday()).toBeNull()
  })

  it('URL de base absente : variable ignorée', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_DEV_TODAY', '2026-09-30')

    expect(getSimulatedToday()).toBeNull()
  })

  it('le récap suit la date simulée : 30/09 → août recapé, 01/10 → septembre', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', DEV_URL)

    vi.stubEnv('NEXT_PUBLIC_DEV_TODAY', '2026-09-30')
    expect(getRecapPeriod()).toEqual({ month: 8, year: 2026 })

    vi.stubEnv('NEXT_PUBLIC_DEV_TODAY', '2026-10-01')
    expect(getRecapPeriod()).toEqual({ month: 9, year: 2026 })
  })

  it.each(['30/09/2026', '2026-9-30', '2026-02-31', '2026-13-01', 'demain', ''])(
    'date invalide « %s » : ignorée plutôt que devinée',
    (value) => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', DEV_URL)
      vi.stubEnv('NEXT_PUBLIC_DEV_TODAY', value)

      expect(getSimulatedToday()).toBeNull()
    },
  )
})
