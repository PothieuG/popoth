/**
 * Part 50 — règles pures du « Transfert d'économies » : sens du mouvement sur
 * le solde et plafond au total des économies.
 */

import { describe, expect, it } from 'vitest'
import {
  exceedsSavingsTransferMax,
  savingsTransferDelta,
  savingsTransferMax,
} from '@/lib/finance/savings-transfer'

describe('savingsTransferDelta', () => {
  it("retire le montant du solde à l'envoi", () => {
    expect(savingsTransferDelta('send', 150)).toBe(-150)
  })

  it('ajoute le montant au solde à la réception', () => {
    expect(savingsTransferDelta('receive', 150)).toBe(150)
  })
})

describe('savingsTransferMax', () => {
  it('vaut le total des économies', () => {
    expect(savingsTransferMax(420.5)).toBe(420.5)
  })

  it('ne descend jamais sous zéro', () => {
    expect(savingsTransferMax(-12)).toBe(0)
  })
})

describe('exceedsSavingsTransferMax', () => {
  it('accepte exactement le total des économies', () => {
    expect(exceedsSavingsTransferMax(300, 300)).toBe(false)
  })

  it('refuse un centime de trop', () => {
    expect(exceedsSavingsTransferMax(300.01, 300)).toBe(true)
  })

  it("compare au centime malgré l'arrondi flottant (0,1 + 0,2)", () => {
    expect(exceedsSavingsTransferMax(0.3, 0.1 + 0.2)).toBe(false)
  })

  it('refuse tout montant quand il n’y a pas d’économies', () => {
    expect(exceedsSavingsTransferMax(1, 0)).toBe(true)
    expect(exceedsSavingsTransferMax(1, -50)).toBe(true)
  })
})
