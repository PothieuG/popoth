import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import RavProjectionRecap from '../RavProjectionRecap'

/**
 * RTL coverage du composant `<RavProjectionRecap>` (encart « reste à vivre
 * estimé : actuel → projeté » des modals solo Add/Edit du planificateur).
 * Vérifie le masquage quand showPreview=false, le code couleur vert/rouge du
 * montant projeté, et l'avertissement role=alert quand le RAV passerait négatif.
 * Le code couleur lui-même est testé exhaustivement dans `rav-color.test.ts`.
 */
describe('<RavProjectionRecap>', () => {
  it('rend rien quand showPreview=false', () => {
    const { container } = render(
      <RavProjectionRecap currentRav={1000} projectedRav={800} showPreview={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('affiche actuel → projeté et colore le projeté en vert quand positif', () => {
    render(<RavProjectionRecap currentRav={1200} projectedRav={950} showPreview={true} />)
    expect(screen.getByTestId('rav-projection-recap')).toBeInTheDocument()
    // 950 est unique (vs 1200) → identifie le span projeté.
    const projected = screen.getByText(/950/)
    expect(projected).toHaveClass('text-green-600')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('colore le projeté en rouge + avertissement quand négatif', () => {
    render(<RavProjectionRecap currentRav={200} projectedRav={-300} showPreview={true} />)
    const projected = screen.getByText(/300/)
    expect(projected).toHaveClass('text-red-600')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/négatif/i)
    expect(alert).toHaveClass('text-red-600')
  })
})
